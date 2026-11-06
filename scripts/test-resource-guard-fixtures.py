#!/usr/bin/env python3
"""Fixed low-commit fixtures. Run ONLY through the reviewed resource guard."""
import ctypes as C
from ctypes import wintypes as W
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time

MIB=1024*1024
# Error codes alone never prove which quota rejected the fixed request.
# Values match Windows SDK winnt.h (22621 and26100).
NEW_PROCESS=6
PROCESS_MEMORY_LIMIT=9
JOB_MEMORY_LIMIT=10

class ProbeFailure(Exception):
    def __init__(self,kind,error=None):
        self.kind,self.error=kind,error
        super().__init__(kind)

class Counters(C.Structure):
    _fields_=[("cb",W.DWORD),("faults",W.DWORD)]+[
        (n,C.c_size_t) for n in ("peakws","ws","peakpaged","paged",
        "peaknonpaged","nonpaged","pagefile","peakpagefile","private")]

def api_instance():
    path=Path(__file__).with_name("test-resource-guard.py")
    spec=importlib.util.spec_from_file_location("bounded_guard_fixture_api",path)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module) # Definitions only; does not run the controller.
    return module.Native()

def allocation(size):
    if size not in (MIB,48*MIB):raise ProbeFailure("allocation_size_invalid")
    kernel=C.WinDLL("kernel32",use_last_error=True)
    kernel.VirtualAlloc.restype=C.c_void_p
    kernel.VirtualAlloc.argtypes=[C.c_void_p,C.c_size_t,C.c_ulong,C.c_ulong]
    kernel.VirtualFree.restype=C.c_int
    kernel.VirtualFree.argtypes=[C.c_void_p,C.c_size_t,C.c_ulong]
    C.set_last_error(0)
    value=kernel.VirtualAlloc(None,size,0x3000,4)
    error=C.get_last_error()
    return kernel,value,error

def release(kernel,value):
    if value and not kernel.VirtualFree(value,0,0x8000):
        raise ProbeFailure("fixture_free_failed",C.get_last_error())

def positive_control():
    kernel,value,error=allocation(MIB)
    if not value:raise ProbeFailure("positive_control_failed",error)
    release(kernel,value)

def private_usage(api, peak=False):
    if C.sizeof(Counters)!=80:raise ProbeFailure("private_counter_layout_invalid")
    fn=api.p.GetProcessMemoryInfo
    fn.restype=W.BOOL;fn.argtypes=[W.HANDLE,C.POINTER(Counters),W.DWORD]
    counters=Counters();counters.cb=C.sizeof(counters)
    if not fn(api.k.GetCurrentProcess(),C.byref(counters),C.sizeof(counters)):
        raise ProbeFailure("private_counter_unavailable",C.get_last_error())
    return counters.peakpagefile if peak else counters.private

def safe_headroom(api):
    sample=api.memory()
    if sample["commitFree"]<8*1024*MIB+128*MIB or sample["ramFree"]<4*1024*MIB:
        raise ProbeFailure("system_headroom_inconclusive")
    return sample

def expect_limits(api,process,tree,count):
    limits=api.limits(None) # Documented immediate job in a nested hierarchy.
    if limits.process!=process or limits.tree!=tree or api.accounting(None).active!=count:
        raise ProbeFailure("fixture_job_or_membership_mismatch")
    if limits.basic.flags & (0x800|0x1000) or limits.basic.flags & 0x300!=0x300:
        raise ProbeFailure("fixture_flags_invalid")

def quota_packets(api,port,expected=None,request_returned_ns=None):
    api.bind(api.k,"GetQueuedCompletionStatus",W.BOOL,W.HANDLE,C.POINTER(W.DWORD),
        C.POINTER(C.c_size_t),C.POINTER(C.c_void_p),W.DWORD)
    if expected is not None and (type(request_returned_ns) is not int or request_returned_ns<=0):
        raise ProbeFailure("quota_notification_time_invalid")
    events=[];deadline_ns=(request_returned_ns+250_000_000) if expected is not None else time.monotonic_ns()
    for _ in range(16):
        message=W.DWORD();key=C.c_size_t();pid=C.c_void_p();C.set_last_error(0)
        wait=0 if expected is None else max(0,min(25,(deadline_ns-time.monotonic_ns())//1_000_000))
        ok=api.k.GetQueuedCompletionStatus(port,C.byref(message),C.byref(key),C.byref(pid),wait)
        error=C.get_last_error()
        if not ok:
            if error!=258 or pid.value is not None:raise ProbeFailure("quota_notification_query_failed",error)
            if expected is None or time.monotonic_ns()>=deadline_ns:break
            continue
        event={"message":message.value,"key":key.value,"pid":pid.value,"dequeuedMonotonicNs":time.monotonic_ns()}
        events.append(event)
        if expected is not None and not request_returned_ns<=event["dequeuedMonotonicNs"]<=deadline_ns:
            raise ProbeFailure("quota_notification_window_exceeded")
        if key.value!=1:raise ProbeFailure("quota_notification_key_invalid")
        if message.value in (PROCESS_MEMORY_LIMIT,JOB_MEMORY_LIMIT):
            if expected is None or message.value!=expected or pid.value!=os.getpid():
                raise ProbeFailure("quota_notification_cause_inconclusive")
            return events
    else:raise ProbeFailure("quota_notification_capacity")
    if expected is not None:raise ProbeFailure("quota_notification_missing")
    return events


def deny_one(api,kind,ancestors,port):
    # Exactly three allocation calls: 1MiB positive, one 48MiB attempt,
    # 1MiB positive. No retry loop, no page touching, at most 50MiB requested.
    pre=quota_packets(api,port)
    if not any(event["message"]==NEW_PROCESS and event["pid"]==os.getpid() for event in pre):
        raise ProbeFailure("quota_notification_process_not_reported")
    positive_control();memory_before=safe_headroom(api)
    # Drain after the positive control; no prior memory-limit packet can be
    # attributed to the sole subsequent fixed48MiB allocation.
    quota_packets(api,port)
    before=private_usage(api)
    if not 0<before<48*MIB:raise ProbeFailure("baseline_inconclusive")
    request_started=time.monotonic_ns()
    kernel,value,error=allocation(48*MIB)
    request_returned=time.monotonic_ns()
    try:
        if value:raise ProbeFailure("unexpected_allocation_success",error)
        if not error:raise ProbeFailure("allocation_failure_error_missing",error)
    finally:release(kernel,value)
    expected=PROCESS_MEMORY_LIMIT if kind=="process-only" else JOB_MEMORY_LIMIT
    notification=quota_packets(api,port,expected,request_returned)
    positive_control();memory_after=safe_headroom(api)
    peak=private_usage(api,peak=True)
    if peak+48*MIB>=96*MIB:raise ProbeFailure("ancestor_process_headroom_inconclusive")
    observed=[]
    for handle,(name,tree,count) in zip(ancestors,(("control",352*MIB,5),("stage",352*MIB,5))):
        limits=api.limits(handle);api.member(handle,api.k.GetCurrentProcess())
        if (limits.process!=96*MIB or limits.tree!=tree or limits.basic.active!=count or
            limits.basic.flags!=0x2708 or limits.peak_tree+48*MIB>=tree):
            raise ProbeFailure("ancestor_headroom_inconclusive")
        observed.append({"name":name,"treeLimitBytes":tree,"peakTreeBytes":limits.peak_tree,
            "requestFitsTree":True,"requestFitsProcess":True})
    # The outer retains the sole family handle for KILL_ON_JOB_CLOSE. Do not
    # duplicate that handle into children. Stage peak plus the outer's hard
    #96MiB process cap is a conservative bound on total family commit.
    family_bound=observed[1]["peakTreeBytes"]+96*MIB
    if family_bound+48*MIB>=448*MIB:raise ProbeFailure("family_headroom_inconclusive")
    observed.append({"name":"family","treeLimitBytes":448*MIB,"commitUpperBoundBytes":family_bound,
        "outerProcessHardCapBytes":96*MIB,"requestFitsTree":True,"requestFitsProcess":True})
    return {"fixture":kind,"verifiedLimit":True,"lastError":error,
        "requestBytes":48*MIB,"baselinePrivateBytes":before,"peakProcessCommitBytes":peak,
        "positiveControlBefore":True,"positiveControlAfter":True,"ancestors":observed,
        "systemBefore":memory_before,"systemAfter":memory_after,
        "notificationContract":"exact-payload-iocp-v1","notification":notification,
        "expectedNotification":expected,"notifiedPid":os.getpid(),
        "notifiedCreationTime":api.identity(api.k.GetCurrentProcess())[1],
        "requestStartedMonotonicNs":request_started,"requestReturnedMonotonicNs":request_returned}

def process_probe(api,ancestors,port):
    expect_limits(api,48*MIB,96*MIB,1)
    # Existing commit >0 plus 48MiB exceeds only the process limit.
    # The same request must fit the payload tree and every ancestor.
    result=deny_one(api,"process-only",ancestors,port);limits=api.limits(None)
    if limits.peak_tree+48*MIB>=96*MIB:raise ProbeFailure("payload_tree_headroom_inconclusive")
    result.update(payloadPeakTreeBytes=limits.peak_tree,payloadTreeLimitBytes=96*MIB)
    return result

def tree_child(api,ancestors,port):
    expect_limits(api,96*MIB,96*MIB,2)
    # Parent still holds 48MiB. Another 48MiB plus positive baselines exceeds
    # the tree, while this process baseline <48MiB keeps its own total <96MiB.
    result=deny_one(api,"tree-only",ancestors,port);limits=api.limits(None)
    if limits.peak_tree+48*MIB<=96*MIB:raise ProbeFailure("payload_tree_cause_inconclusive")
    result.update(payloadPeakTreeBytes=limits.peak_tree,payloadTreeLimitBytes=96*MIB)
    return result

def tree_parent(api,ancestors,port):
    expect_limits(api,96*MIB,96*MIB,1)
    positive_control();safe_headroom(api)
    if not 0<private_usage(api)<48*MIB:raise ProbeFailure("parent_baseline_inconclusive")
    kernel,hold,error=allocation(48*MIB)
    if not hold:raise ProbeFailure("parent_hold_failed",error)
    child=None
    try:
        startup=subprocess.STARTUPINFO();startup.lpAttributeList={"handle_list":list(ancestors)+[port]}
        child=subprocess.Popen([sys.executable,"-I","-B",str(Path(__file__).resolve()),"tree-child"]+sys.argv[2:],
            stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
            creationflags=0x00000008,startupinfo=startup,close_fds=True)
        # Retain the original creation handle through exit, notification identity
        # and timing checks. No PID lookup or reopening is used.
        original_child=api.identity(int(child._handle))
        child_stdout,child_stderr=child.communicate(timeout=3)
        if len(child_stdout)>2048 or len(child_stderr)>2048:
            raise ProbeFailure("child_output_invalid")
        if (child.returncode!=0 or api.k.WaitForSingleObject(int(child._handle),0)!=0 or
            api.exit_code(int(child._handle))!=0):raise ProbeFailure("tree_child_inconclusive")
        result=json.loads(child_stdout);notification=result.get("notification",[])
        if (result.get("fixture")!="tree-only" or result.get("verifiedLimit") is not True or
            (result.get("notifiedPid"),result.get("notifiedCreationTime"))!=original_child or
            child.pid!=original_child[0] or not notification or notification[-1].get("pid")!=original_child[0] or
            not result.get("requestReturnedMonotonicNs",1)<=notification[-1].get("dequeuedMonotonicNs",0)<=result.get("requestReturnedMonotonicNs",0)+250_000_000):
            raise ProbeFailure("tree_child_proof_invalid")
    finally:
        if child is not None:
            for stream in (child.stdout,child.stderr):
                if stream:stream.close()
            # CPython Handle.Close calls checked _winapi.CloseHandle and marks
            # that same original handle closed; exceptions stay fixture failures.
            child._handle.Close()
        release(kernel,hold)
    positive_control();safe_headroom(api)
    # Parent + child: exactly six calls and at most 100MiB requested in total;
    # not all committed concurrently, and no pages are touched.
    parent_peak=private_usage(api,peak=True)
    if parent_peak>=96*MIB:raise ProbeFailure("parent_process_peak_inconclusive")
    parent_identity=api.identity(api.k.GetCurrentProcess())
    result.update(parentPid=parent_identity[0],parentCreationTime=parent_identity[1],
        originalChildPid=original_child[0],originalChildCreationTime=original_child[1],
        originalChildExitObserved=True,originalChildCheckedClose=True,
        parentHoldBytes=48*MIB,parentPeakProcessCommitBytes=parent_peak,
        allocationCallsUpperBound=6,totalRequestedUpperBound=100*MIB)
    return result

def fixed_context(module,api,mode):
    if len(sys.argv)!=(8 if mode in ("process-only","tree-only","tree-child") else 5):
        raise ProbeFailure("fixed_context_arguments_invalid")
    out=module.project_path(sys.argv[2]);launch,digest=module.hashed_json(out/"launch.json")
    identity=api.identity(api.k.GetCurrentProcess())
    fixture_hash=module.hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    if (launch.get("token")!=sys.argv[3] or launch.get("sourceSha256")!=sys.argv[4] or
        module.hashlib.sha256(Path(__file__).with_name("test-resource-guard.py").read_bytes()).hexdigest()!=sys.argv[4] or
        launch.get("fixtureSha256")!=fixture_hash or launch.get("resumeNotYetRequested") is not True or
        (mode!="tree-child" and (launch.get("subjectPid"),launch.get("subjectCreationTime"))!=identity) or
        launch.get("fixtureMode")!=("tree-only" if mode=="tree-child" else mode)):
        raise ProbeFailure("fixed_context_binding_invalid")
    entered={"schemaVersion":1,"token":launch["token"],"sourceSha256":launch["sourceSha256"],
        "launchSha256":digest,"fixtureSha256":fixture_hash,"subjectPid":launch["subjectPid"],
        "subjectCreationTime":launch["subjectCreationTime"],"fixtureMode":launch["fixtureMode"]}
    return out,launch,digest,entered


def fixed_wait(api,mode,out,launch,digest,entered):
    api.small_json(out/"entered.json",entered,sync=True)
    if mode=="timeout-sleep":time.sleep(8);return 0
    for _ in range(120):
        if (out/"release.json").exists():
            release=api.read_small(out/"release.json",4096)
            if (set(release)!={"token","sourceSha256","launchSha256","contenderOutputDir","contenderReceiptSha256"} or
                release["token"]!=launch["token"] or release["sourceSha256"]!=launch["sourceSha256"] or
                release["launchSha256"]!=digest):raise ProbeFailure("serial_release_binding_invalid")
            contender=api.project_path(release["contenderOutputDir"])
            receipt,receipt_hash=api.hashed_json(contender/"command-exit.json",4096)
            refusal,refusal_hash=api.hashed_json(contender/"gate-refusal.json",4096)
            expected={"schemaVersion":1,"token":refusal.get("token"),"sourceSha256":launch["sourceSha256"],
                "ownerToken":launch["token"],"gateRefusalSha256":refusal_hash,"publicExitCode":73,"invocations":1,
                "checkPassed":True,"operationSucceeded":False,"cleanupVerified":True}
            if (receipt_hash!=release["contenderReceiptSha256"] or receipt!=expected or
                not api.valid_hex(refusal.get("token"),32) or refusal.get("winerror") not in (32,33) or
                refusal.get("sourceSha256")!=launch["sourceSha256"] or refusal.get("ownerToken")!=launch["token"] or
                refusal.get("ownerLaunchSha256")!=digest or
                refusal.get("ownerLeaseBefore")!=refusal.get("ownerLeaseAfter") or
                refusal.get("payloadCreated") is not False or refusal.get("leaseRegistered") is not False):
                raise ProbeFailure("serial_receipt_invalid")
            print("serial owner released after verified contender");return 0
        time.sleep(.025)
    raise ProbeFailure("serial_release_missing")


def main():
    if os.name!="nt" or len(sys.argv)<2 or not sys.flags.isolated or not sys.dont_write_bytecode:
        return 2
    mode=sys.argv[1]
    if mode=="exit":
        print("bounded fixture exited");return 0
    if mode=="sleep":
        time.sleep(8);return 0
    if mode in ("process-only","tree-only","tree-child","serial-owner","timeout-sleep"):
        try:
            module_path=Path(__file__).with_name("test-resource-guard.py")
            spec=importlib.util.spec_from_file_location("bounded_guard_fixture_context",module_path)
            module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
            api=module.Native()
            out,launch,digest,entered=fixed_context(module,api,mode)
            if mode in ("serial-owner","timeout-sleep"):
                expect_limits(api,48*MIB,64*MIB,1)
                return fixed_wait(module,mode,out,launch,digest,entered)
            if launch.get("quotaNotificationContract")!="exact-payload-iocp-v1":
                raise ProbeFailure("quota_notification_contract_invalid")
            ancestors=tuple(int(h) for h in sys.argv[5:7]);port=int(sys.argv[7])
            result=process_probe(api,ancestors,port) if mode=="process-only" else tree_parent(api,ancestors,port) if mode=="tree-only" else tree_child(api,ancestors,port)
            print(json.dumps(result));return 0
        except BaseException as error:
            print(json.dumps({"fixture":mode,"verifiedLimit":False,
                "outcome":error.kind if isinstance(error,ProbeFailure) else "fixture_exception",
                "lastError":error.error if isinstance(error,ProbeFailure) else None,
                "errorType":type(error).__name__}))
            return 9
    if mode=="breakaway":
        try:
            child=subprocess.Popen([sys.executable,"-I","-B",str(Path(__file__).resolve()),"exit"],
                creationflags=0x01000000,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        except OSError as error:
            print("breakaway_denied",error.winerror)
            return 0 if error.winerror==5 else 7
        child.wait(timeout=2);print("unexpected_breakaway_success");return 8
    if mode=="residual":
        subprocess.Popen([sys.executable,"-I","-B",str(Path(__file__).resolve()),"sleep"],
            stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        print("owned residual child created");return 0
    if mode=="bounded-log":
        for _ in range(257):os.write(1,b"x"*4096)
        return 0
    return 2

if __name__=="__main__":
    sys.exit(main())
