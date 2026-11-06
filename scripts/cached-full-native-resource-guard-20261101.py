#!/usr/bin/env python3
"""Windows-only, cooperative test fault containment. No compiler or third-party modules."""
import ctypes as C
from ctypes import wintypes as W
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

MIB = 1024 * 1024
GIB = 1024 * MIB
TASK_ROOT = Path(r"E:\Codex\UAgent\2026-10-29")
GLOBAL_ROOT = TASK_ROOT / "test-resource-guard"
PROFILES = {
    "micro": (48*MIB, 64*MIB, 3, 5, 32),
    "micro-process": (48*MIB, 96*MIB, 3, 5, 32),
    "micro-tree": (96*MIB, 96*MIB, 3, 5, 32),
    "check": (512*MIB, 768*MIB, 8, 60, 256),
    # Fixed current-task command allowlist only; never admitted by ordinary run.
    "product-check": (512*MIB, 640*MIB, 8, 60, 256),
    # Two exact single-command checks; credential multi-worker profile unchanged.
    "narrow-check": (512*MIB, 512*MIB, 8, 60, 256),
    # Frozen native test executable only; preserve historical narrow-check semantics.
    "direct-native128": (128*MIB, 128*MIB, 8, 60, 256),
    # Exact integrated-product builds only. Existing profiles retain their semantics.
    "integrated-web512": (512*MIB, 640*MIB, 8, 120, 384),
    # Vite without source maps: smaller V8 heap and stricter aggregate ceiling.
    "integrated-web256": (512*MIB, 512*MIB, 8, 120, 256),
    "integrated-web-serial": (512*MIB, 512*MIB, 8, 120, 256),
    "integrated-native768": (768*MIB, 896*MIB, 12, 360, 384),
    # Fresh bound frontend/native pair. Earlier fixed commands retain their destinations.
    "integrated-web-bound512": (512*MIB, 512*MIB, 8, 120, 256),
    "integrated-native-bound768": (768*MIB, 896*MIB, 12, 360, 384),
    # New exact semi-space-tuned pair; same OS caps/floors, fresh destinations.
    "integrated-web-semi8": (512*MIB, 512*MIB, 8, 120, 256),
    "integrated-native-bound-r5": (768*MIB, 896*MIB, 12, 360, 384),
    "managed-store-interface384": (384*MIB, 384*MIB, 8, 60, 256),
    "types": (768*MIB, 1024*MIB, 8, 120, 512),
    "build": (2048*MIB, 3072*MIB, 16, 360, 1024),
}
# (stage limits, whole public-family limits, public operation deadline).
# Stage = payload tree +160MiB controller +96MiB watcher; family adds96MiB closer.
INTEGRATED_BUILD_LIMITS = {
    "integrated-web512": ((512*MIB,896*MIB,10),(512*MIB,992*MIB,11),135),
    "integrated-web256": ((512*MIB,768*MIB,10),(512*MIB,864*MIB,11),135),
    "integrated-web-serial": ((512*MIB,768*MIB,10),(512*MIB,864*MIB,11),135),
    "integrated-native768": ((768*MIB,1152*MIB,14),(768*MIB,1248*MIB,15),375),
    "integrated-web-bound512": ((512*MIB,768*MIB,10),(512*MIB,864*MIB,11),135),
    "integrated-native-bound768": ((768*MIB,1152*MIB,14),(768*MIB,1248*MIB,15),375),
    "integrated-web-semi8": ((512*MIB,768*MIB,10),(512*MIB,864*MIB,11),135),
    "integrated-native-bound-r5": ((768*MIB,1152*MIB,14),(768*MIB,1248*MIB,15),375),
    "managed-store-interface384": ((384*MIB,640*MIB,10),(384*MIB,736*MIB,11),75),
}
WATCHDOG_LIMIT = 96 * MIB
CONTROL_RESERVE = 160 * MIB
RAM_FLOOR = 4 * GIB
COMMIT_FLOOR = 8 * GIB
LOG_LIMIT = 1024 * 1024
# Fixed internal metadata mode; never accepted as a user workload profile.
METADATA_PROFILE = (96*MIB,96*MIB,1,10,32)
INVALID = C.c_void_p(-1).value
KILL_ON_CLOSE = 0x2000
PROCESS_MEMORY = 0x100
JOB_MEMORY = 0x200
ACTIVE_PROCESS = 0x8
DIE_ON_EXCEPTION = 0x400
BREAKAWAY = 0x800 | 0x1000
WAIT_OBJECT = 0
WAIT_TIMEOUT = 258

# Positive32-bit failure verdict: tag0x10, fixed phase byte, native detail word.
# Nonzero diagnostics never grant admission or establish successful cleanup.
DIAGNOSTIC_TAG=0x10000000
EARLY_PHASES={
    "fixed_fixture_required":20,"controller_arguments_invalid":21,
    "controller_mode_invalid":22,"closure_parent_identity_invalid":23,
    "spec_schema_invalid":24,"closure_scope_fixed_only":25,"args_invalid":26,
    "executable_invalid":27,"insufficient_system_headroom":28,"serial_busy":29,
    "windows_x64_required":30,"native_layout_mismatch":31,
    "closure_layout_mismatch":32,"diagnostic_layout_mismatch":33,
    "assign_job_failed":34,"query_limits_failed":35,"create_job_failed":36,
    "set_limits_failed":37,"limits_readback_mismatch":38,
    "insufficient_combined_headroom":39,"membership_missing":40,
    "fixed_closure_required":41,"fixture_contract_mismatch":42,
    "system_headroom_floor":43,"closure_timeout":44,"closure_exit_codes_failed":45,
    "closure_packet_invalid":46,"closure_controller_without_packet":47,
    "closure_wait_failed":48,"closure_rundown_unconfirmed":49,"closure_close_failed":50,
    "closure_pid_list_incomplete":51,"gate_controller_without_packet":52,
    "system_memory_unavailable":55,"system_memory_invalid":56,
}


def diagnostic_exit(phase, detail=0):
    # A bounded primitive OS exit value; no path, JSON, hash, stdout or file I/O.
    return DIAGNOSTIC_TAG|((phase&255)<<16)|(detail if type(detail) is int and 0<=detail<65535 else 65535)


def diagnostic_failure(error, phase):
    if isinstance(error,GuardError):
        code=error.code
        if (error.kind in ("closure_controller_without_packet","gate_controller_without_packet") and type(code) is int and
            (code&0xff000000)==DIAGNOSTIC_TAG):
            return code # Actual exit of the held original controller, not a PID lookup.
        return diagnostic_exit(EARLY_PHASES.get(error.kind,phase),0 if code is None else code)
    kinds=(KeyError,TypeError,ValueError,OSError,RuntimeError)
    detail=next((n for n,t in enumerate(kinds,1) if isinstance(error,t)),6)
    return diagnostic_exit(phase|64,detail)


class GuardError(Exception):
    def __init__(self, kind, code=None):
        self.kind, self.code = kind, code
        super().__init__(kind)

class IO(C.Structure):
    _fields_ = [(n, C.c_ulonglong) for n in
                ("ro", "wo", "oo", "rb", "wb", "ob")]
class BasicLimit(C.Structure):
    _fields_ = [("pt", C.c_longlong), ("jt", C.c_longlong),
        ("flags", W.DWORD), ("minws", C.c_size_t), ("maxws", C.c_size_t),
        ("active", W.DWORD), ("affinity", C.c_size_t),
        ("priority", W.DWORD), ("scheduling", W.DWORD)]
class ExtendedLimit(C.Structure):
    _fields_ = [("basic", BasicLimit), ("io", IO),
        ("process", C.c_size_t), ("tree", C.c_size_t),
        ("peak_process", C.c_size_t), ("peak_tree", C.c_size_t)]
class Accounting(C.Structure):
    _fields_ = [(n, C.c_longlong) for n in ("ut", "kt", "pu", "pk")] + [
        ("faults", W.DWORD), ("total", W.DWORD),
        ("active", W.DWORD), ("terminated", W.DWORD)]
class Performance(C.Structure):
    _fields_ = [("cb", W.DWORD)] + [(n, C.c_size_t) for n in (
        "commit", "limit", "peak", "physical", "available", "cache",
        "kernel", "paged", "nonpaged", "page")] + [
        ("handles", W.DWORD), ("processes", W.DWORD), ("threads", W.DWORD)]
class Security(C.Structure):
    _fields_ = [("length", W.DWORD), ("descriptor", C.c_void_p), ("inherit", W.BOOL)]
class Startup(C.Structure):
    _fields_ = [("cb", W.DWORD), ("reserved", W.LPWSTR),
        ("desktop", W.LPWSTR), ("title", W.LPWSTR)] + [
        (n, W.DWORD) for n in ("x","y","xs","ys","xc","yc","fill","flags")] + [
        ("show", W.WORD), ("reserved_size", W.WORD), ("reserved2", C.c_void_p),
        ("stdin", W.HANDLE), ("stdout", W.HANDLE), ("stderr", W.HANDLE)]
class StartupEx(C.Structure):
    _fields_ = [("startup", Startup), ("attributes", C.c_void_p)]
class ProcessInfo(C.Structure):
    _fields_ = [("process", W.HANDLE), ("thread", W.HANDLE),
               ("pid", W.DWORD), ("tid", W.DWORD)]

class ClosurePacket(C.Structure):
    _fields_=[("magic",W.DWORD),("version",W.DWORD),("controllerPid",W.DWORD),
        ("observerPid",W.DWORD),("workerPid",W.DWORD),("reserved",W.DWORD),
        ("controllerCreation",C.c_ulonglong),("observerCreation",C.c_ulonglong),
        ("workerCreation",C.c_ulonglong),("observerHandle",W.HANDLE),("workerHandle",W.HANDLE),
        ("token",C.c_char*32),("output",C.c_wchar*1001)]

DIAG_STRIDE=8192
DIAG_BYTES=2*DIAG_STRIDE
DIAG_SLOTS=16
DIAG_OUTER,DIAG_CONTROLLER,DIAG_OBSERVER,DIAG_WORKER=range(4)
# Event rows: code,target-role,pid,tid,creation,handle,result,error,exit,time-ns.
class DiagnosticIdentity(C.Structure):
    _fields_=[("pid",W.DWORD),("parentPid",W.DWORD),("creation",C.c_ulonglong),("parentCreation",C.c_ulonglong)]
class DiagnosticEvent(C.Structure):
    _fields_=[("time",C.c_ulonglong),("pid",W.DWORD),("tid",W.DWORD),
        ("creation",C.c_ulonglong),("handle",C.c_ulonglong),("code",W.DWORD),
        ("target",W.DWORD),("result",W.DWORD),("error",W.DWORD),("exit",W.DWORD),("reserved",W.DWORD)]
class DiagnosticLane(C.Structure):
    _fields_=[("sequence",W.DWORD),("count",W.DWORD),("overflow",W.DWORD),("role",W.DWORD),
        ("identity",DiagnosticIdentity),("events",DiagnosticEvent*DIAG_SLOTS)]
class DiagnosticBank(C.Structure):
    _fields_=[("magic",W.DWORD),("version",W.DWORD),("stage",W.DWORD),("packetReady",W.DWORD),
        ("packetAccepted",W.DWORD),("outerState",W.DWORD),("reserved",W.DWORD*2),
        ("token",C.c_char*32),("packet",ClosurePacket),("acceptedPacket",ClosurePacket),("lanes",DiagnosticLane*4)]

class Native:
    def __init__(self):
        if os.name != "nt" or C.sizeof(C.c_void_p) != 8:
            raise GuardError("windows_x64_required")
        if [C.sizeof(x) for x in (ExtendedLimit, Accounting, Performance, Startup, StartupEx, ProcessInfo)] != [144,48,104,104,112,24]:
            raise GuardError("native_layout_mismatch")
        if C.sizeof(ClosurePacket)!=2104:raise GuardError("closure_layout_mismatch")
        if [C.sizeof(t) for t in (DiagnosticEvent,DiagnosticLane,DiagnosticBank)]!=[56,936,8016]:raise GuardError("diagnostic_layout_mismatch")
        self.diag=None;self.diag_startup=None
        self.k = C.WinDLL("kernel32", use_last_error=True)
        self.p = C.WinDLL("psapi", use_last_error=True)
        self.bind(self.k, "CreateJobObjectW", W.HANDLE, C.c_void_p, W.LPCWSTR)
        self.bind(self.k, "SetInformationJobObject", W.BOOL, W.HANDLE, C.c_int, C.c_void_p, W.DWORD)
        self.bind(self.k, "QueryInformationJobObject", W.BOOL, W.HANDLE, C.c_int, C.c_void_p, W.DWORD, C.c_void_p)
        self.bind(self.k, "AssignProcessToJobObject", W.BOOL, W.HANDLE, W.HANDLE)
        self.bind(self.k, "IsProcessInJob", W.BOOL, W.HANDLE, W.HANDLE, C.POINTER(W.BOOL))
        self.bind(self.k, "TerminateJobObject", W.BOOL, W.HANDLE, W.UINT)
        self.bind(self.k, "GetCurrentProcess", W.HANDLE)
        self.bind(self.k, "OpenProcess", W.HANDLE, W.DWORD, W.BOOL, W.DWORD)
        self.bind(self.k, "OpenJobObjectW", W.HANDLE, W.DWORD, W.BOOL, W.LPCWSTR)
        self.bind(self.k, "DuplicateHandle", W.BOOL, W.HANDLE, W.HANDLE, W.HANDLE, C.POINTER(W.HANDLE), W.DWORD, W.BOOL, W.DWORD)
        self.bind(self.k, "CloseHandle", W.BOOL, W.HANDLE)
        self.bind(self.k, "CreateFileW", W.HANDLE, W.LPCWSTR, W.DWORD, W.DWORD, C.c_void_p, W.DWORD, W.DWORD, W.HANDLE)
        self.bind(self.k, "CreatePipe", W.BOOL, C.POINTER(W.HANDLE), C.POINTER(W.HANDLE), C.c_void_p, W.DWORD)
        self.bind(self.k, "SetHandleInformation", W.BOOL, W.HANDLE, W.DWORD, W.DWORD)
        self.bind(self.k, "CreateEventW", W.HANDLE, C.c_void_p, W.BOOL, W.BOOL, W.LPCWSTR)
        self.bind(self.k, "SetEvent", W.BOOL, W.HANDLE)
        self.bind(self.k, "WaitForSingleObject", W.DWORD, W.HANDLE, W.DWORD)
        self.bind(self.k, "WaitForMultipleObjects", W.DWORD, W.DWORD, C.POINTER(W.HANDLE), W.BOOL, W.DWORD)
        self.bind(self.k, "GetExitCodeProcess", W.BOOL, W.HANDLE, C.POINTER(W.DWORD))
        self.bind(self.k, "GetProcessId", W.DWORD, W.HANDLE)
        self.bind(self.k, "GetProcessTimes", W.BOOL, W.HANDLE, C.POINTER(W.FILETIME), C.POINTER(W.FILETIME), C.POINTER(W.FILETIME), C.POINTER(W.FILETIME))
        self.bind(self.k, "ResumeThread", W.DWORD, W.HANDLE)
        self.bind(self.k, "TerminateProcess", W.BOOL, W.HANDLE, W.UINT)
        self.bind(self.k, "InitializeProcThreadAttributeList", W.BOOL, C.c_void_p, W.DWORD, W.DWORD, C.POINTER(C.c_size_t))
        self.bind(self.k, "UpdateProcThreadAttribute", W.BOOL, C.c_void_p, W.DWORD, C.c_size_t, C.c_void_p, C.c_size_t, C.c_void_p, C.c_void_p)
        self.bind(self.k, "DeleteProcThreadAttributeList", None, C.c_void_p)
        self.bind(self.k, "CreateProcessW", W.BOOL, W.LPCWSTR, W.LPWSTR, C.c_void_p, C.c_void_p, W.BOOL, W.DWORD, C.c_void_p, W.LPCWSTR, C.c_void_p, C.POINTER(ProcessInfo))
        self.bind(self.k, "PeekNamedPipe", W.BOOL, W.HANDLE, C.c_void_p, W.DWORD, C.c_void_p, C.POINTER(W.DWORD), C.c_void_p)
        self.bind(self.k, "ReadFile", W.BOOL, W.HANDLE, C.c_void_p, W.DWORD, C.POINTER(W.DWORD), C.c_void_p)
        self.bind(self.k, "WriteFile", W.BOOL, W.HANDLE, C.c_void_p, W.DWORD, C.POINTER(W.DWORD), C.c_void_p)
        self.bind(self.k, "GetModuleFileNameW", W.DWORD, W.HANDLE, W.LPWSTR, W.DWORD)
        self.bind(self.k, "CreateFileMappingW", W.HANDLE, W.HANDLE, C.c_void_p, W.DWORD, W.DWORD, W.DWORD, W.LPCWSTR)
        self.bind(self.k, "MapViewOfFile", C.c_void_p, W.HANDLE, W.DWORD, W.DWORD, W.DWORD, C.c_size_t)
        self.bind(self.k, "UnmapViewOfFile", W.BOOL, C.c_void_p)
        self.bind(self.k, "SetErrorMode", W.UINT, W.UINT)
        self.bind(self.p, "GetPerformanceInfo", W.BOOL, C.POINTER(Performance), W.DWORD)
    @staticmethod
    def bind(lib, name, result, *args):
        fn = getattr(lib, name); fn.restype = result; fn.argtypes = list(args)
    @staticmethod
    def check(ok, kind):
        if not ok: raise GuardError(kind, C.get_last_error())
    def close(self, h):
        if h and h != INVALID:
            result=self.k.CloseHandle(h);error=C.get_last_error()
            diagnostic_closed(self,h,result,0 if result else error);C.set_last_error(error)
            return result
    def dup(self, h, access=0):
        out=W.HANDLE();current=self.k.GetCurrentProcess()
        self.check(self.k.DuplicateHandle(current,h,current,C.byref(out),access,True,0 if access else 2),"duplicate_handle_failed")
        return out.value
    def dup_target(self, h, target, access=0):
        # Target is the original verified suspended-created observer handle;
        # the caller checks identity/memberships, never an arbitrary PID search.
        out=W.HANDLE()
        self.check(self.k.DuplicateHandle(self.k.GetCurrentProcess(),h,target,C.byref(out),access,False,0 if access else 2),"gate_duplicate_failed")
        return out.value
    def limits(self, job):
        value = ExtendedLimit()
        self.check(self.k.QueryInformationJobObject(job,9,C.byref(value),C.sizeof(value),None),"query_limits_failed")
        return value
    def job(self, name, process, tree, active, kill=True):
        C.set_last_error(0); h = self.k.CreateJobObjectW(None,name)
        self.check(h,"create_job_failed")
        if C.get_last_error() == 183:
            self.close(h); raise GuardError("job_name_collision")
        try:
            info = ExtendedLimit()
            info.basic.flags = PROCESS_MEMORY|JOB_MEMORY|ACTIVE_PROCESS|DIE_ON_EXCEPTION|(KILL_ON_CLOSE if kill else 0)
            info.basic.active,info.process,info.tree = active,process,tree
            self.check(self.k.SetInformationJobObject(h,9,C.byref(info),C.sizeof(info)),"set_limits_failed")
            actual=self.limits(h)
            if actual.basic.flags != info.basic.flags or actual.basic.flags & BREAKAWAY or actual.process != process or actual.tree != tree or actual.basic.active != active:
                raise GuardError("limits_readback_mismatch")
            return h
        except BaseException:
            self.close(h); raise
    def assign(self, job, process):
        self.check(self.k.AssignProcessToJobObject(job,process),"assign_job_failed")
        self.member(job,process)
    def member(self, job, process):
        if not self.is_member(job,process):raise GuardError("membership_missing")
    def is_member(self, job, process):
        inside=W.BOOL()
        self.check(self.k.IsProcessInJob(process,job,C.byref(inside)),"verify_membership_failed")
        return bool(inside.value)
    def identity(self, process):
        pid=self.k.GetProcessId(process);self.check(pid,"process_identity_unavailable")
        created,ended,kernel,user=(W.FILETIME() for _ in range(4))
        self.check(self.k.GetProcessTimes(process,C.byref(created),C.byref(ended),C.byref(kernel),C.byref(user)),"process_time_unavailable")
        return pid,(created.dwHighDateTime<<32)|created.dwLowDateTime
    def accounting(self, job):
        value=Accounting()
        self.check(self.k.QueryInformationJobObject(job,1,C.byref(value),C.sizeof(value),None),"accounting_unavailable")
        return value
    def pid_list(self, job):
        # Fixed 32-entry buffer; no allocation growth or larger-buffer retry.
        capacity=32;buffer=C.create_string_buffer(8+capacity*C.sizeof(C.c_size_t))
        returned=W.DWORD();C.set_last_error(0)
        ok=self.k.QueryInformationJobObject(job,3,buffer,C.sizeof(buffer),C.byref(returned))
        error=C.get_last_error()
        if not ok and error!=234:raise GuardError("job_pid_list_unavailable",error)
        raw=buffer.raw
        assigned=int.from_bytes(raw[0:4],"little");listed=int.from_bytes(raw[4:8],"little")
        pids=[int.from_bytes(raw[8+i*8:16+i*8],"little") for i in range(min(listed,capacity))]
        complete=bool(ok and assigned==listed and listed<=capacity and len(set(pids))==listed and all(0<p<=0xffffffff for p in pids))
        return {"assigned":assigned,"listed":listed,"pids":pids,
            "complete":complete,"capacity":capacity,"returnBytes":returned.value,"winerror":None if ok else error}
    def job_snapshot(self, job):
        value=self.accounting(job)
        return {"active":value.active,"total":value.total,"terminated":value.terminated,
            "pidList":self.pid_list(job)}
    def memory(self):
        value=Performance();value.cb=C.sizeof(value)
        self.check(self.p.GetPerformanceInfo(C.byref(value),C.sizeof(value)),"system_memory_unavailable")
        if value.page < 4096 or value.page > MIB or value.commit > value.limit or value.available > value.physical or not value.limit:
            raise GuardError("system_memory_invalid")
        return {"commit":value.commit*value.page,"commitLimit":value.limit*value.page,
                "commitFree":(value.limit-value.commit)*value.page,
                "ramFree":value.available*value.page,"ramTotal":value.physical*value.page}
    def pipe(self):
        a,b=W.HANDLE(),W.HANDLE();sa=Security(C.sizeof(Security),None,True)
        self.check(self.k.CreatePipe(C.byref(a),C.byref(b),C.byref(sa),16384),"create_pipe_failed")
        try:
            self.check(self.k.SetHandleInformation(a,1,0),"pipe_inherit_failed")
            return a.value,b.value
        except BaseException:
            self.close(a.value);self.close(b.value);raise
    def spawn(self, executable, args, cwd, env, std, inherited=()):
        handles=list(dict.fromkeys(list(std)+list(inherited)))
        si=StartupEx();si.startup.cb=C.sizeof(si);si.startup.flags=0x100
        si.startup.stdin,si.startup.stdout,si.startup.stderr=std
        needed=C.c_size_t()
        self.k.InitializeProcThreadAttributeList(None,1,0,C.byref(needed))
        if not 0 < needed.value <= 16384: raise GuardError("attribute_size_invalid")
        attrs=C.create_string_buffer(needed.value)
        self.check(self.k.InitializeProcThreadAttributeList(attrs,1,0,C.byref(needed)),"attribute_init_failed")
        try:
            array=(W.HANDLE*len(handles))(*handles)
            self.check(self.k.UpdateProcThreadAttribute(attrs,0,0x20002,C.cast(array,C.c_void_p),C.sizeof(array),None,None),"attribute_handles_failed")
            si.attributes=C.cast(attrs,C.c_void_p)
            command=subprocess.list2cmdline([str(executable)]+args)
            if len(command)>30000:raise GuardError("command_too_long")
            command=C.create_unicode_buffer(command)
            block=C.create_unicode_buffer("\0".join(k+"="+v for k,v in sorted(env.items(),key=lambda kv:kv[0].lower()))+"\0\0")
            pi=ProcessInfo()
            self.check(self.k.CreateProcessW(str(executable),command,None,None,True,0x0008040C,block,str(cwd),C.byref(si),C.byref(pi)),"create_suspended_failed")
            return pi
        finally:self.k.DeleteProcThreadAttributeList(attrs)
    def resume(self, pi):
        if self.k.ResumeThread(pi.thread)==0xffffffff:raise GuardError("resume_failed",C.get_last_error())
        self.close(pi.thread);pi.thread=None
    def exit_code(self, process):
        value=W.DWORD();self.check(self.k.GetExitCodeProcess(process,C.byref(value)),"exit_code_unavailable")
        return value.value
    def empty(self, job, timeout=3):
        deadline=time.monotonic()+timeout
        while time.monotonic()<deadline:
            if self.accounting(job).active==0:return True
            time.sleep(.05)
        return self.accounting(job).active==0

def small_json(path, value, exclusive=True, sync=False):
    data=json.dumps(value,separators=(",",":"),ensure_ascii=True).encode()
    if len(data)>16384:raise GuardError("metadata_too_large")
    with open(path,"xb" if exclusive else "wb") as f:
        f.write(data)
        if sync:f.flush();os.fsync(f.fileno())

def read_small(path, maximum=16384):
    with open(path,"rb") as f:
        data=f.read(maximum+1)
    if len(data)>maximum:raise GuardError("input_too_large")
    return json.loads(data)

def project_path(raw, must_exist=True):
    if not isinstance(raw,str) or len(raw)>1000:raise GuardError("path_invalid")
    p=Path(raw)
    if not p.is_absolute() or p.drive.upper() not in ("E:","G:"):raise GuardError("project_drive_required")
    for part in (p,*p.parents):
        if part.exists() and part.stat(follow_symlinks=False).st_file_attributes & 0x400:
            raise GuardError("reparse_path_rejected")
    p=p.resolve(strict=must_exist)
    return p

def child_environment(oldspace):
    # Deliberately do not enumerate/copy inherited API keys, tokens or credentials.
    names=("SystemRoot","WINDIR","ComSpec","PATHEXT","PATH","USERPROFILE","APPDATA","LOCALAPPDATA",
        "PROGRAMDATA","ProgramFiles","ProgramFiles(x86)","CommonProgramFiles","NUMBER_OF_PROCESSORS",
        "PROCESSOR_ARCHITECTURE","INCLUDE","LIB","LIBPATH","VSINSTALLDIR","VCINSTALLDIR","WindowsSdkDir")
    env={k:os.environ[k] for k in names if k in os.environ}
    temp=str(TASK_ROOT/"temp")
    env.update(TEMP=temp,TMP=temp,TMPDIR=temp,
        CARGO_HOME=str(TASK_ROOT/"build-cache/native-cargo-home"),
        CARGO_TARGET_DIR=str(TASK_ROOT/"build-cache/native-build-target"),
        CARGO_NET_OFFLINE="true",CARGO_BUILD_JOBS="1",
        VITE_CACHE_DIR=str(TASK_ROOT/"build-cache/vite"),
        UAGENT_VITE_CACHE_DIR=str(TASK_ROOT/"build-cache/vite"),
        NODE_OPTIONS="--max-old-space-size="+str(oldspace),
        PYTHONDONTWRITEBYTECODE="1",PYTHONNOUSERSITE="1")
    return env



def rundown_sample(api, control, observer_job, payload, origin_ns, phase, held):
    current=api.k.GetCurrentProcess()
    return {"phase":phase,"elapsedMs":(time.monotonic_ns()-origin_ns)//1000000,
        "epochMs":time.time_ns()//1000000,"controllerHandleHeld":held,
        "control":api.job_snapshot(control),"observerJob":api.job_snapshot(observer_job),
        "payloadActive":api.accounting(payload).active,
        "observerInControl":api.is_member(control,current),
        "observerInOwnJob":api.is_member(observer_job,current),
        "observerInPayload":api.is_member(payload,current)}

def only_observer_proven(sample, observer_pid):
    # Keep active==1. Also require complete matching native PID lists and live
    # memberships; a count alone cannot authenticate the remaining process.
    def exact(job):
        ids=job["pidList"]
        return (job["active"]==1 and ids["complete"] is True and
            ids["assigned"]==ids["listed"]==1 and ids["pids"]==[observer_pid])
    return (sample["payloadActive"]==0 and sample["observerInControl"] is True and
        sample["observerInOwnJob"] is True and sample["observerInPayload"] is False and
        exact(sample["control"]) and exact(sample["observerJob"]))


def rundown_record_valid(proof):
    sample=proof.get("controlRundownProof")
    samples=proof.get("rundownSamples")
    released=proof.get("controllerHandleReleasedElapsedMs")
    if (proof.get("controllerHandleReleased") is not True or
        type(released) is not int or released<0 or not isinstance(sample,dict) or
        not isinstance(samples,list) or not 2<=len(samples)<=9 or sample not in samples):
        return False
    stamp=sample.get("elapsedMs")
    return (sample.get("phase")=="after-controller-reference-release" and
        sample.get("controllerHandleHeld") is False and type(stamp) is int and stamp>=released and
        only_observer_proven(sample,proof.get("observerPid")))

def watchdog(api, args):
    # Destructive authority is restricted to inherited new-domain jobs and the
    # original creation-time-bound controller handle. Old jobs are never opened here.
    if len(args)!=16:raise GuardError("watchdog_arguments_invalid")
    job,parent,stop,gate_input,control,watch_self,ready_event=[int(s) for s in args[:7]]
    timeout=int(args[7]);token=args[9];expected_parent=(int(args[10]),int(args[11]));kind=args[12]
    if kind not in ("run","recover","verify") or not valid_hex(token,32) or not 1<=timeout<=360:
        raise GuardError("watchdog_bounds_invalid")
    metadata=kind!="run";out=Path(args[8]) if metadata else project_path(args[8])
    if metadata and out!=metadata_output(token):raise GuardError("watchdog_output_invalid")
    gate=None if metadata else gate_input;gate_pipe=gate_input if metadata else None
    mapping,index,diagnostic_outer=int(args[13]),int(args[14]),int(args[15])
    view=diagnostic_view(api,mapping);diagnostic_attach(api,view,index,DIAG_OBSERVER,token)
    diagnostic_track(api,parent,DIAG_CONTROLLER,expected_parent)
    witness=api.diag["bank"].lanes[DIAG_OUTER].identity
    diagnostic_outer_identity=api.identity(diagnostic_outer)
    diagnostic_event(api,13,DIAG_OUTER,*diagnostic_outer_identity,handle=diagnostic_outer,
        result=diagnostic_outer_identity==(witness.pid,witness.creation))
    diagnostic_track(api,diagnostic_outer,DIAG_OUTER,diagnostic_outer_identity)
    owned=False;finish_requested=False;parent_gone=False;origin_ns=time.monotonic_ns()
    report={"token":token,"operationKind":kind,"reason":"watchdog_exception","terminated":False,
        "activeZero":False,"controllerExitConfirmed":False,"controlOnlyObserver":False,"cleanupConfirmed":False,
        "controlTerminationPlanned":False,"requiresExternalConfirmation":True,"rundownSamples":[],
        "rundownSampleMaximum":9,"controllerHandleReleased":False,
        "readyNativeConfirmed":False,"gateTransferred":not metadata}
    def receive_gate():
        nonlocal gate,gate_pipe
        if gate_pipe is None:return
        available=W.DWORD()
        api.check(api.k.PeekNamedPipe(gate_pipe,None,0,None,C.byref(available),None),"gate_transfer_unavailable")
        if available.value>8:raise GuardError("gate_transfer_size_invalid")
        if available.value==8:
            buffer=C.create_string_buffer(8);count=W.DWORD()
            api.check(api.k.ReadFile(gate_pipe,buffer,8,C.byref(count),None),"gate_transfer_read_failed")
            if count.value!=8:raise GuardError("gate_transfer_short_read")
            gate=int.from_bytes(buffer.raw,"little")
            if not gate or gate==INVALID:raise GuardError("gate_transfer_handle_invalid")
            report["gateTransferred"]=True
            api.check(api.k.CloseHandle(gate_pipe),"gate_transfer_pipe_close_failed");gate_pipe=None
    try:
        if api.identity(parent)!=expected_parent or expected_parent[0]==os.getpid():
            raise GuardError("watchdog_parent_identity_mismatch")
        for owner,process in ((control,parent),(control,api.k.GetCurrentProcess()),(watch_self,api.k.GetCurrentProcess())):
            api.member(owner,process)
        if api.is_member(job,parent) or api.is_member(job,api.k.GetCurrentProcess()):
            raise GuardError("watchdog_sibling_boundary_invalid")
        payload_limits=api.limits(job);watch_limits=api.limits(watch_self);control_limits=api.limits(control)
        profiles=(METADATA_PROFILE,) if metadata else tuple(PROFILES.values())
        if not any(payload_limits.process==p and payload_limits.tree==t and payload_limits.basic.active==a and timeout==s
                   for p,t,a,s,_ in profiles):raise GuardError("watchdog_payload_limits_invalid")
        expected={"payload":limits_record(payload_limits.process,payload_limits.tree,payload_limits.basic.active),
            "control":limits_record(max(payload_limits.process,96*MIB),payload_limits.tree+CONTROL_RESERVE+WATCHDOG_LIMIT,payload_limits.basic.active+2),
            "observer":limits_record(WATCHDOG_LIMIT,WATCHDOG_LIMIT,1)}
        actual={name:{"process":v.process,"tree":v.tree,"activeLimit":v.basic.active,"flags":v.basic.flags}
            for name,v in (("payload",payload_limits),("control",control_limits),("observer",watch_limits))}
        if actual!=expected:raise GuardError("watchdog_job_limits_invalid")
        memory=api.memory();required=control_limits.tree
        if memory["ramFree"]<RAM_FLOOR+required or memory["commitFree"]<COMMIT_FLOOR+required:
            raise GuardError("insufficient_system_headroom")
        owned=True
        report["sourceSha256"]=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        report["memoryInitial"]=memory;report["minRamFree"]=memory["ramFree"];report["minCommitFree"]=memory["commitFree"]
        report["startupMemberships"]={"controllerInControl":True,"observerInControl":True,"observerInOwnJob":True}
        report["startupLimits"]=actual
        report["observerPid"],report["observerCreationTime"]=api.identity(api.k.GetCurrentProcess())
        report["controllerPid"],report["controllerCreationTime"]=expected_parent
        if not metadata:
            small_json(out/"watchdog-ready.json",{"token":token,"ready":True,
                "controllerPid":expected_parent[0],"controllerCreationTime":expected_parent[1]})
        # Metadata readiness requires no file or gate I/O. Controller may acquire
        # the shared gate only after this event; its exact duplicate arrives by pipe.
        api.check(api.k.SetEvent(ready_event),"watchdog_ready_signal_failed");report["readyNativeConfirmed"]=True
        deadline=time.monotonic()+timeout
        api.diag_startup=diagnostic_capture(api,{"control":control,"payload":job,"observer":watch_self},
            {DIAG_OUTER:diagnostic_outer,DIAG_CONTROLLER:parent,DIAG_OBSERVER:api.k.GetCurrentProcess(),DIAG_WORKER:None})
        handles=(W.HANDLE*2)(parent,stop);report["reason"]="timeout"
        while time.monotonic()<deadline:
            receive_gate()
            memory=api.memory();report["memoryLast"]=memory
            report["minRamFree"]=min(report["minRamFree"],memory["ramFree"])
            report["minCommitFree"]=min(report["minCommitFree"],memory["commitFree"])
            if memory["ramFree"]<RAM_FLOOR or memory["commitFree"]<COMMIT_FLOOR:
                report["reason"]="system_headroom_floor";break
            if finish_requested:
                signal=api.k.WaitForSingleObject(parent,100)
                if signal==WAIT_OBJECT:parent_gone=True;break
                if signal!=WAIT_TIMEOUT:raise GuardError("watchdog_wait_failed",C.get_last_error())
            else:
                signal=api.k.WaitForMultipleObjects(2,handles,False,100)
                if signal==0:parent_gone=True;break
                if signal==1:finish_requested=True
                elif signal!=WAIT_TIMEOUT:raise GuardError("watchdog_wait_failed",C.get_last_error())
        receive_gate() # Also consume a transfer when the parent exits in the same wait.
        finish_requested=finish_requested or api.k.WaitForSingleObject(stop,0)==WAIT_OBJECT
        if parent_gone:
            report["controllerExitCode"]=api.exit_code(parent)
            report["reason"]="completed" if finish_requested and report["controllerExitCode"]==75 and report["gateTransferred"] else "controller_failed"
    except BaseException as error:
        report["reason"]="watchdog_exception";report["errorType"]=type(error).__name__
        if isinstance(error,GuardError):report["errorKind"]=error.kind;report["winerror"]=error.code
    finally:
        if owned:
            if report["reason"]!="completed":
                try:
                    api.check(api.k.TerminateJobObject(job,124),"watchdog_terminate_failed");report["terminated"]=True
                except GuardError as error:report["payloadTerminateError"]=error.kind;report["payloadTerminateWinerror"]=error.code
            try:report["activeZero"]=api.empty(job,1)
            except GuardError as error:report["payloadExitError"]=error.kind
            try:
                if api.k.WaitForSingleObject(parent,0)!=WAIT_OBJECT:
                    api.check(api.k.TerminateProcess(parent,124),"controller_terminate_failed");report["controllerTerminationRequested"]=True
                report["controllerExitConfirmed"]=api.k.WaitForSingleObject(parent,1000)==WAIT_OBJECT
                if report["controllerExitConfirmed"]:
                    report["controllerExitCode"]=api.exit_code(parent)
                    diagnostic_event(api,8,DIAG_CONTROLLER,*expected_parent,handle=parent,result=1,exit_code=report["controllerExitCode"])
            except GuardError as error:report["controllerTerminateError"]=error.kind;report["controllerTerminateWinerror"]=error.code
            query_failed=False
            try:
                report["rundownSamples"].append(rundown_sample(api,control,watch_self,job,origin_ns,"controller-reference-held",parent is not None))
            except GuardError as error:report["rundownQueryError"]={"kind":error.kind,"winerror":error.code};query_failed=True
            if report["controllerExitConfirmed"]:
                try:
                    diagnostic_checked_close(api,parent,"controller_reference_release_failed")
                    report["controllerHandleReleased"]=True
                    report["controllerHandleReleasedElapsedMs"]=(time.monotonic_ns()-origin_ns)//1000000
                except GuardError as error:report["controllerReferenceReleaseError"]={"kind":error.kind,"winerror":error.code};query_failed=True
                parent=None # Never retry an explicitly failed close.
            if report["controllerExitConfirmed"] and not query_failed:
                for index in range(8):
                    try:
                        sample=rundown_sample(api,control,watch_self,job,origin_ns,"after-controller-reference-release",False)
                        report["rundownSamples"].append(sample)
                    except GuardError as error:
                        report["rundownQueryError"]={"kind":error.kind,"winerror":error.code};break
                    if only_observer_proven(sample,report["observerPid"]):
                        report["controlOnlyObserver"]=True;report["controlRundownProof"]=sample;break
                    if not sample["control"]["pidList"]["complete"] or not sample["observerJob"]["pidList"]["complete"]:break
                    if index<7:time.sleep(.1)
            report["cleanupConfirmed"]=all(report[k] for k in ("activeZero","controllerExitConfirmed","controlOnlyObserver","gateTransferred"))
            report["requiresExternalConfirmation"]=not report["cleanupConfirmed"]
            if not report["cleanupConfirmed"]:report["reason"]="cleanup_unconfirmed";report["controlTerminationPlanned"]=True
            try:
                if report["readyNativeConfirmed"] and out.exists():
                    project_path(str(out));diagnostic_event(api,11,DIAG_OBSERVER,result=report["cleanupConfirmed"])
                    diagnostic_save(api,out,"observer-final",{"control":control,"payload":job,"observer":watch_self},
                        {DIAG_OUTER:diagnostic_outer,DIAG_CONTROLLER:parent,DIAG_OBSERVER:api.k.GetCurrentProcess(),DIAG_WORKER:None})
                    small_json(out/"watchdog-result.json",report)
            finally:
                if report["controlTerminationPlanned"]:api.k.TerminateJobObject(control,124)
        for h in (job,parent,stop,gate_pipe,ready_event):api.close(h)
        # Retain the exact serial gate through actual OS exit, including final
        # report I/O and Python shutdown. No next operation can overlap this observer.
        global _WATCH_CONTROL_HANDLE,_WATCH_SELF_HANDLE,_WATCH_GATE_HANDLE
        _WATCH_CONTROL_HANDLE,_WATCH_SELF_HANDLE,_WATCH_GATE_HANDLE=control,watch_self,gate
    return 0 if report["reason"]=="completed" and report["cleanupConfirmed"] else 124


def valid_hex(value, size):
    return isinstance(value,str) and len(value)==size and all(c in "0123456789abcdef" for c in value)


def hashed_json(path, maximum=16384):
    with open(project_path(str(path)),"rb") as stream:data=stream.read(maximum+1)
    if len(data)>maximum:raise GuardError("input_too_large")
    value=json.loads(data)
    if not isinstance(value,dict):raise GuardError("metadata_object_required")
    return value,hashlib.sha256(data).hexdigest()


def serial_gate(api, existing=False):
    project_path(str(GLOBAL_ROOT))
    path=GLOBAL_ROOT/"serial.lock"
    project_path(str(path),False)
    gate=api.k.CreateFileW(str(path),0xC0000000,0,None,3 if existing else 4,0x80,None)
    if not gate or gate==INVALID:
        error=C.get_last_error()
        raise GuardError("serial_busy" if error in (32,33) else "serial_gate_failed",error)
    return gate


def current_lease():
    # The legacy failed lease is immutable. A small atomic head selects each
    # subsequent immutable lease; malformed/missing indexed state never falls back.
    head=GLOBAL_ROOT/"current-lease.json"
    if head.exists():
        pointer,_=hashed_json(head,4096)
        if (set(pointer)!={"schemaVersion","token","leaseSha256"} or pointer["schemaVersion"]!=1 or
            not valid_hex(pointer["token"],32) or not valid_hex(pointer["leaseSha256"],64)):
            raise GuardError("lease_head_invalid")
        path=GLOBAL_ROOT/"leases"/(pointer["token"]+".json")
        state,digest=hashed_json(path,4096)
        if state.get("token")!=pointer["token"] or digest!=pointer["leaseSha256"]:
            raise GuardError("lease_head_mismatch")
    else:
        # An interrupted first registration must not silently reuse the legacy lease.
        if (GLOBAL_ROOT/"leases").exists():raise GuardError("lease_head_missing")
        path=GLOBAL_ROOT/"last-lease.json"
        if not path.exists():return None
        state,digest=hashed_json(path,4096)
    token=state.get("token")
    if (state.get("schemaVersion") not in (1,2) or not valid_hex(token,32) or
        type(state.get("guardianPid")) is not int or state["guardianPid"]<=0 or
        state.get("controlJob")!="Global\\UAgent.TestResourceGuard.control."+token or
        state.get("payloadJob")!="Global\\UAgent.TestResourceGuard.payload."+token):
        raise GuardError("previous_lease_invalid")
    project_path(state.get("outputDir"))
    return {"state":state,"binding":{"path":str(path),"token":token,"sha256":digest}}


def old_jobs_empty(api, state):
    # Query-only access. Never CreateJobObject with an old name, open a PID,
    # request termination, retry a denial, or grow the fixed native PID buffer.
    observations=[]
    for role in ("control","payload","watchdog"):
        name="Global\\UAgent.TestResourceGuard."+role+"."+state["token"]
        C.set_last_error(0);job=api.k.OpenJobObjectW(4,False,name)
        error=C.get_last_error()
        observation={"role":role,"name":name,"epochMs":time.time_ns()//1000000}
        if not job:
            if error!=2:raise GuardError("previous_"+role+"_job_unconfirmed",error)
            observation.update(status="absent",winerror=2)
        else:
            try:
                snapshot=api.job_snapshot(job)
                ids=snapshot["pidList"]
                if not (snapshot["active"]==0 and ids["complete"] is True and
                    ids["assigned"]==ids["listed"]==0 and ids["pids"]==[]):
                    raise GuardError("previous_"+role+"_job_not_proven_empty")
                observation.update(status="empty",snapshot=snapshot)
            finally:
                api.check(api.k.CloseHandle(job),"previous_query_handle_close_failed")
        observations.append(observation)
    return observations


def recovery_evidence(entries, state):
    if not isinstance(entries,list) or not 2<=len(entries)<=5:
        raise GuardError("recovery_evidence_invalid")
    out=project_path(state["outputDir"])
    allowed={out/"result.json",out/"watchdog-result.json",out/"watchdog-ready.json",
        out.parent/"summary.json",out.parent/"spec.json",out/"launch.json",out/"entered.json",
        out/"timeout-check.json",out/"command-exit.json"}
    # One frozen historical fixture failure lost both recorders when the closer
    # revoked its stage on the first unexpected worker exit. Bind its original
    # launch, exact input/source hashes and actual held-root receipt; this does
    # not verify that failed run. recover_lease still requires current exact
    # three-job emptiness under the same serial gate and protected final proof.
    missing_record_incident=(state["token"]=="fca9999c96dc4679bdf34bf79ad64253" and
        str(out)==str(TASK_ROOT/"evidence"/"test-resource-guard-post-reboot-20261031-active"/"process-run-01"))
    incident_hashes={
        str(out/"launch.json"):"1e8c030f8b413b0ae9dfaaa2463adec30f3861b4e186f892f7b6fbdf144a6b04",
        str(out.parent/"process-spec.json"):"be7fa734ac0802dcbc23fab3a878e645c33dafe5f9ce117fb754136e386013f1",
        str(out.parent/"process-invocation.json"):"3453a4fe6f906f8399d2c64eeaea0e5425b49f092998b796329b22d73f528af9",
        str(out.parent/"process-command-exit.json"):"7e1dd7c9e09b507aab5fc5e14c4edba2046c334a6e725f8bd2e86ba57229f8fe"}
    if missing_record_incident:allowed.update(Path(path) for path in incident_hashes)
    observed=[];values={}
    for entry in entries:
        if (not isinstance(entry,dict) or set(entry)!={"path","sha256"} or
            not valid_hex(entry["sha256"],64)):
            raise GuardError("recovery_evidence_invalid")
        path=project_path(entry["path"])
        if path not in allowed or str(path) in values:raise GuardError("recovery_evidence_path_invalid")
        value,digest=hashed_json(path)
        if digest!=entry["sha256"]:raise GuardError("recovery_evidence_hash_mismatch")
        observed.append({"path":str(path),"sha256":digest});values[str(path)]=value
    report=values.get(str(out/"result.json"),{})
    proof=values.get(str(out/"watchdog-result.json"),{})
    if not report and not proof and missing_record_incident:
        hashes={entry["path"]:entry["sha256"] for entry in observed}
        launch=values.get(str(out/"launch.json"),{})
        invocation=values.get(str(out.parent/"process-invocation.json"),{})
        receipt=values.get(str(out.parent/"process-command-exit.json"),{})
        if (hashes!=incident_hashes or (out/"result.json").exists() or (out/"watchdog-result.json").exists() or
            launch.get("token")!=state["token"] or launch.get("controllerPid")!=state["guardianPid"] or
            launch.get("controlJob")!=state["controlJob"] or launch.get("payloadJob")!=state["payloadJob"] or
            launch.get("sourceSha256")!=invocation.get("guardSha256") or
            launch.get("fixtureSha256")!=invocation.get("fixtureSha256") or
            launch.get("specSha256")!=invocation.get("specSha256") or
            receipt.get("rootPid")!=invocation.get("rootPid") or
            receipt.get("rootCreationTime")!=invocation.get("rootCreationTime") or
            receipt.get("actualPublicExitCode")!=diagnostic_exit(45) or
            any(receipt.get(k) is not True for k in ("originalRootExitObserved","originalThreadCheckedClose","originalRootCheckedClose")) or
            any(receipt.get(k) is not False for k in ("checkPassed","operationSucceeded","cleanupVerified"))):
            raise GuardError("missing_record_incident_binding_invalid")
        return observed
    if not report:
        report=values.get(str(out/"launch.json"),{})
        check=values.get(str(out/"timeout-check.json"),{});receipt=values.get(str(out/"command-exit.json"),{})
        hashes={entry["path"]:entry["sha256"] for entry in observed}
        expected_receipt={"schemaVersion":1,"token":state["token"],"sourceSha256":report.get("sourceSha256"),
            "launchSha256":hashes.get(str(out/"launch.json")),"watchdogSha256":hashes.get(str(out/"watchdog-result.json")),
            "timeoutCheckSha256":hashes.get(str(out/"timeout-check.json")),"publicExitCode":74,"invocations":1,
            "checkPassed":True,"operationSucceeded":False,"cleanupVerified":True}
        if (set(values)!={str(out/name) for name in ("launch.json","entered.json","watchdog-result.json","timeout-check.json","command-exit.json")} or
            report.get("contract")!="timeout-check" or report.get("outcome")!="expected_timeout_launch" or
            check.get("targetToken")!=state["token"] or check.get("sourceSha256")!=report.get("sourceSha256") or
            check.get("targetLaunchSha256")!=expected_receipt["launchSha256"] or
            check.get("targetWatchdogSha256")!=expected_receipt["watchdogSha256"] or
            check.get("targetEnteredSha256")!=hashes.get(str(out/"entered.json")) or
            check.get("operationSucceeded") is not False or check.get("cleanupVerified") is not True or
            receipt!=expected_receipt):raise GuardError("timeout_recovery_binding_invalid")
    if (report.get("token")!=state["token"] or proof.get("token")!=state["token"] or
        report.get("controlJob")!=state["controlJob"] or report.get("payloadJob")!=state["payloadJob"] or
        report.get("controllerPid")!=state["guardianPid"] or
        proof.get("controllerPid")!=report.get("controllerPid") or
        proof.get("controllerCreationTime")!=report.get("controllerCreationTime") or
        proof.get("observerPid")!=report.get("observerPid") or
        proof.get("observerCreationTime")!=report.get("observerCreationTime") or
        report.get("verifiedSuccess") is not False or
        any(type(report.get(k)) is not int or report[k]<=0 for k in
            ("controllerPid","controllerCreationTime","observerPid","observerCreationTime"))):
        raise GuardError("recovery_evidence_identity_mismatch")
    return observed


def recovery_receipt_path(binding):
    return GLOBAL_ROOT/("cleanup-receipt-"+binding["token"]+"-"+binding["sha256"]+".json")


def empty_observations_valid(observations, token):
    if not isinstance(observations,list) or len(observations)!=3:return False
    for role,item in zip(("control","payload","watchdog"),observations):
        if not isinstance(item,dict):return False
        if (item.get("role")!=role or
            item.get("name")!="Global\\UAgent.TestResourceGuard."+role+"."+token or
            type(item.get("epochMs")) is not int):return False
        if item.get("status")=="absent":
            if item.get("winerror")!=2:return False
        elif item.get("status")=="empty":
            snapshot=item.get("snapshot",{});ids=snapshot.get("pidList",{})
            if not (snapshot.get("active")==0 and ids.get("complete") is True and
                ids.get("assigned")==ids.get("listed")==0 and ids.get("pids")==[]):return False
        else:return False
    return True


def diagnostic_view(api, mapping):
    view=api.k.MapViewOfFile(mapping,0xF001F,0,0,DIAG_BYTES)
    api.check(view,"diagnostic_map_failed")
    return view


def diagnostic_attach(api, view, index, role, token, initialize=False, outer_identity=None):
    if index not in (0,1) or role not in range(4) or not valid_hex(token,32):
        raise GuardError("diagnostic_context_invalid")
    address=view+index*DIAG_STRIDE
    if initialize:
        C.memset(address,0,DIAG_STRIDE)
        bank=DiagnosticBank.from_address(address)
        bank.magic=0x34474155;bank.version=1;bank.stage=index;bank.token=token.encode("ascii")
        for n in range(4):bank.lanes[n].role=n
        bank.lanes[DIAG_OUTER].identity.pid,bank.lanes[DIAG_OUTER].identity.creation=outer_identity
    bank=DiagnosticBank.from_address(address)
    actual=api.identity(api.k.GetCurrentProcess())
    if (bank.magic!=0x34474155 or bank.version!=1 or bank.stage!=index or bank.token.decode("ascii")!=token):
        raise GuardError("diagnostic_context_invalid")
    api.diag={"view":view,"index":index,"role":role,"bank":bank,"handles":{}}
    expected=(bank.lanes[role].identity.pid,bank.lanes[role].identity.creation)
    # Creator-handle identity and executing-self identity are both diagnostic
    # witnesses. A mismatch is recorded, never used to relax existing checks.
    diagnostic_event(api,1,role,actual[0],actual[1],result=actual==expected)


def diagnostic_event(api, code, target, pid=0, creation=0, handle=0, result=0, error=0, exit_code=0, tid=0, native_pid=0):
    context=getattr(api,"diag",None)
    if context is None:return
    lane=context["bank"].lanes[context["role"]]
    lane.sequence+=1
    if lane.count>=DIAG_SLOTS:lane.overflow=1
    else:
        event=lane.events[lane.count]
        event.time=time.monotonic_ns();event.pid=pid;event.tid=tid;event.creation=creation
        event.handle=int(handle or 0)&0xffffffffffffffff;event.code=code;event.target=target
        event.result=int(bool(result));event.error=int(error or 0);event.exit=int(exit_code)&0xffffffff
        event.reserved=int(native_pid)
        lane.count+=1
    lane.sequence+=1


def diagnostic_track(api, handle, role, identity, thread=False):
    context=getattr(api,"diag",None)
    if context is None or not handle:return
    if len(context["handles"])>=16:raise GuardError("diagnostic_handle_capacity")
    context["handles"][int(handle)]=(role,identity,bool(thread))


def diagnostic_created(api, role, pi):
    context=getattr(api,"diag",None)
    if context is None:return
    identity=api.identity(pi.process);parent=api.identity(api.k.GetCurrentProcess())
    target=context["bank"].lanes[role].identity
    target.pid,target.creation=identity;target.parentPid,target.parentCreation=parent
    diagnostic_track(api,pi.process,role,identity)
    diagnostic_track(api,pi.thread,role,identity,True)
    diagnostic_event(api,2,role,*identity,handle=pi.process,result=1,tid=pi.tid,native_pid=pi.pid)
    diagnostic_event(api,3,role,*identity,handle=pi.thread,result=1,tid=pi.tid,native_pid=pi.pid)


def diagnostic_closed(api, handle, result, error):
    context=getattr(api,"diag",None)
    if context is None:return
    known=context["handles"].pop(int(handle),None)
    if known:
        role,identity,thread=known
        diagnostic_event(api,5 if thread else 4,role,*identity,handle=handle,result=result,error=error)


def diagnostic_checked_close(api, handle, kind):
    result=api.k.CloseHandle(handle);error=C.get_last_error()
    diagnostic_closed(api,handle,result,0 if result else error)
    C.set_last_error(error);api.check(result,kind)


def diagnostic_packet(api, packet, accepted=False, received=False, received_bytes=0):
    context=getattr(api,"diag",None)
    if context is None:return
    bank=context["bank"]
    if accepted:bank.packetAccepted=1
    elif received:
        C.memmove(C.byref(bank.acceptedPacket),C.byref(packet),C.sizeof(ClosurePacket));bank.reserved[0]=1
    else:
        C.memmove(C.byref(bank.packet),C.byref(packet),C.sizeof(ClosurePacket));bank.packetReady=1
    diagnostic_event(api,7 if accepted else 14 if received else 6,context["role"],result=1,tid=received_bytes)


def diagnostic_token(value):
    # Fixed32 raw bytes, including embedded NUL/non-ASCII; never used for acceptance.
    raw=C.string_at(C.addressof(value)+type(value).token.offset,32)
    return {"hex":raw.hex(),"text":raw.decode("ascii","replace"),
        "valid":all(48<=c<=57 or 97<=c<=102 for c in raw)}

def diagnostic_banks(api):
    context=api.diag;result=[]
    for index in range(context["index"]+1):
        address=context["view"]+index*DIAG_STRIDE
        first=C.string_at(address,C.sizeof(DiagnosticBank));second=C.string_at(address,C.sizeof(DiagnosticBank))
        bank=DiagnosticBank.from_buffer_copy(second)
        lanes=[]
        for lane in bank.lanes:
            identity=lane.identity
            rows=[[e.code,e.target,e.pid,e.tid,e.creation,e.handle,e.result,e.error,e.exit,e.time,e.reserved]
                for e in list(lane.events)[:min(lane.count,DIAG_SLOTS)]]
            lanes.append({"role":lane.role,"sequence":lane.sequence,"count":lane.count,"overflow":bool(lane.overflow),
                "identity":[identity.pid,identity.creation,identity.parentPid,identity.parentCreation],"events":rows})
        packet=bank.packet
        result.append({"stage":bank.stage,"token":diagnostic_token(bank),"stableBytes":first==second and all(l.sequence%2==0 for l in bank.lanes),
            "packetReady":bool(bank.packetReady),"packetReceived":bool(bank.reserved[0]),"packetAccepted":bool(bank.packetAccepted),"lanes":lanes,
            "packet":{"controller":[packet.controllerPid,packet.controllerCreation],
                "observer":[packet.observerPid,packet.observerCreation,packet.observerHandle or 0],
                "worker":[packet.workerPid,packet.workerCreation,packet.workerHandle or 0],
                "token":diagnostic_token(packet),"outputPrefix":packet.output[:256],"outputChars":len(packet.output)},
            "acceptedPacket":{"controller":[bank.acceptedPacket.controllerPid,bank.acceptedPacket.controllerCreation],
                "observer":[bank.acceptedPacket.observerPid,bank.acceptedPacket.observerCreation,bank.acceptedPacket.observerHandle or 0],
                "worker":[bank.acceptedPacket.workerPid,bank.acceptedPacket.workerCreation,bank.acceptedPacket.workerHandle or 0],
                "token":diagnostic_token(bank.acceptedPacket),"outputPrefix":bank.acceptedPacket.output[:256],"outputChars":len(bank.acceptedPacket.output)}})
    return result


def diagnostic_capture(api, jobs, actors):
    # Existing owned handles only. Unknown numeric PID-list entries are never opened.
    snapshots={name:api.job_snapshot(handle) for name,handle in jobs.items()}
    membership={}
    for role,handle in actors.items():
        if handle:
            identity=api.identity(handle)
            membership[str(role)]={"identity":list(identity),
                "jobs":{name:api.is_member(job,handle) for name,job in jobs.items()}}
    return {"jobs":snapshots,"knownOriginalMemberships":membership,"unavailableOriginalRoles":[r for r,h in actors.items() if not h]}


def diagnostic_save(api, out, phase, jobs, actors):
    image=C.create_unicode_buffer(512);C.set_last_error(0)
    image_chars=api.k.GetModuleFileNameW(None,image,512);image_error=C.get_last_error()
    value={"schemaVersion":1,"diagnosticOnly":True,"phase":phase,"stageBanks":diagnostic_banks(api),
        "eventFields":["code","targetRole","pid","tid","creation","handle","ok","winerror","exit","monotonicNs","nativeProcessInfoPid"],
        "eventCodes":{"1":"attach","2":"process-created","3":"thread-created","4":"process-close",
            "5":"thread-close","6":"packet-published","7":"packet-accepted","8":"exit-observed",
            "9":"stage-empty","10":"failure","11":"prepared-exit","12":"gate-transferred","13":"original-identity-witness","14":"packet-native-read"},
        "roleNames":["outer","controller","observer","worker"],
        "interpreter":{"executable":str(sys.executable)[:300],"baseExecutable":str(getattr(sys,"_base_executable",""))[:300],
            "prefix":str(sys.prefix)[:300],"basePrefix":str(sys.base_prefix)[:300],"version":sys.version[:100],
            "isolated":sys.flags.isolated,"noSite":sys.flags.no_site,"noBytecode":bool(sys.dont_write_bytecode),"selfModuleImage":image.value[:511],"selfModuleImageComplete":0<image_chars<512,"selfModuleImageError":image_error},
        "startup":getattr(api,"diag_startup",None),"current":diagnostic_capture(api,jobs,actors)}
    data=json.dumps(value,separators=(",",":"),ensure_ascii=True).encode()
    if len(data)>32768:raise GuardError("diagnostic_output_too_large")
    with open(out/("diagnostic-"+phase+".json"),"xb") as stream:stream.write(data)


def metadata_output(token):
    return TASK_ROOT/"evidence"/"test-resource-guard-metadata-operations"/token


def limits_record(process, tree, active):
    return {"process":process,"tree":tree,"activeLimit":active,
        "flags":PROCESS_MEMORY|JOB_MEMORY|ACTIVE_PROCESS|DIE_ON_EXCEPTION|KILL_ON_CLOSE}


def profile_values(report):
    kind=report.get("operationKind")
    if kind=="run" and report.get("profile") in PROFILES:return PROFILES[report["profile"]]
    if kind in ("recover","verify") and report.get("profile")=="metadata":return METADATA_PROFILE
    raise GuardError("proof_profile_invalid")


def success_records_valid(report, proof, state=None):
    # One predicate for workload verification, successful lease admission and
    # protection-domain confirmation of provisional recovery receipts.
    try:
        if not isinstance(report,dict) or not isinstance(proof,dict):return False
        token=report.get("token")
        if not valid_hex(token,32) or not valid_hex(report.get("sourceSha256"),64):return False
        process,tree,active,seconds,_=profile_values(report)
        identities=("controllerPid","controllerCreationTime","observerPid","observerCreationTime")
        if any(type(report.get(k)) is not int or report[k]<=0 or proof.get(k)!=report[k] for k in identities):return False
        if report["controllerPid"]==report["observerPid"]:return False
        if any(type(report.get(k)) is not int or report[k]<=0 for k in ("subjectPid","subjectCreationTime")):return False
        if report["subjectPid"] in (report["controllerPid"],report["observerPid"]):return False
        if any(report.get(role+"Job")!="Global\\UAgent.TestResourceGuard."+role+"."+token
               for role in ("control","payload","watchdog")):return False
        if state is not None and (state.get("token")!=token or state.get("guardianPid")!=report["controllerPid"] or
            state.get("controlJob")!=report["controlJob"] or state.get("payloadJob")!=report["payloadJob"] or
            state.get("outputDir")!=report.get("outputDir")):return False
        checks=(report.get("preparedForExternalVerification") is True,report.get("verifiedSuccess") is False,
            report.get("outcome")=="completed",report.get("subjectExitCode")==0,
            report.get("rootExitedWithDescendants") is False,report.get("subjectResumed") is True,
            report.get("subjectMembershipVerified") is True,report.get("watchdogReady") is True,
            report.get("activeZero") is True,proof.get("token")==token,
            proof.get("operationKind")==report.get("operationKind"),proof.get("reason")=="completed",
            proof.get("cleanupConfirmed") is True,proof.get("controllerExitConfirmed") is True,
            proof.get("controllerExitCode")==75,proof.get("controlOnlyObserver") is True,
            proof.get("activeZero") is True,proof.get("requiresExternalConfirmation") is False,
            proof.get("controlTerminationPlanned") is False,proof.get("gateTransferred") is True,
            proof.get("readyNativeConfirmed") is True,
            report.get("processLimitBytes")==process,report.get("treeLimitBytes")==tree,
            report.get("activeProcessLimit")==active,report.get("timeoutSeconds")==seconds)
        if not all(checks) or not rundown_record_valid(proof):return False
        expected={"payload":limits_record(process,tree,active),
            "control":limits_record(max(process,96*MIB),tree+CONTROL_RESERVE+WATCHDOG_LIMIT,active+2),
            "observer":limits_record(WATCHDOG_LIMIT,WATCHDOG_LIMIT,1)}
        return (proof.get("startupLimits")==expected and proof.get("startupMemberships")==
            {"controllerInControl":True,"observerInControl":True,"observerInOwnJob":True} and
            proof.get("memoryInitial",{}).get("ramFree",0)>=RAM_FLOOR+expected["control"]["tree"] and
            proof.get("memoryInitial",{}).get("commitFree",0)>=COMMIT_FLOOR+expected["control"]["tree"] and
            proof.get("minRamFree",0)>=RAM_FLOOR and proof.get("minCommitFree",0)>=COMMIT_FLOOR)
    except (GuardError,KeyError,TypeError,ValueError,AttributeError):return False


def finished_domain(api, raw, state=None):
    out=project_path(raw)
    report,report_hash=hashed_json(out/"result.json")
    proof,proof_hash=hashed_json(out/"watchdog-result.json")
    if report.get("outputDir")!=str(out) or not success_records_valid(report,proof,state):
        raise GuardError("run_not_verified")
    operation=None
    if report["operationKind"]!="run":
        if out!=metadata_output(report["token"]):raise GuardError("metadata_output_invalid")
        operation,digest=hashed_json(out/"operation-result.json")
        identity={"controllerPid":report["controllerPid"],"controllerCreationTime":report["controllerCreationTime"],
            "observerPid":report["observerPid"],"observerCreationTime":report["observerCreationTime"],
            "workerPid":report["subjectPid"],"workerCreationTime":report["subjectCreationTime"]}
        if (operation.get("schemaVersion")!=1 or operation.get("token")!=report["token"] or
            operation.get("operationKind")!=report["operationKind"] or operation.get("outcome")!="completed" or
            operation.get("identity")!=identity or digest!=report.get("operationResultSha256")):
            raise GuardError("metadata_result_unconfirmed")
    # Recorded startup/final memberships plus creation-time-bound controller exit
    # and complete empty jobs prove original members exited. No PID is opened.
    jobs=old_jobs_empty(api,{"token":report["token"]})
    return {"report":report,"proof":proof,"reportSha256":report_hash,"proofSha256":proof_hash,
        "operation":operation,"jobs":jobs}


def value_sha256(value):
    return hashlib.sha256(json.dumps(value,separators=(",",":"),ensure_ascii=True).encode()).hexdigest()


def attempt_base(binding):
    if (not isinstance(binding,dict) or not valid_hex(binding.get("token"),32) or
        not valid_hex(binding.get("sha256"),64)):raise GuardError("attempt_lease_invalid")
    return GLOBAL_ROOT/"recovery-attempts"/(binding["token"]+"-"+binding["sha256"])


def attempt_directory(binding, attempt_id):
    if not valid_hex(attempt_id,32):raise GuardError("attempt_id_invalid")
    return attempt_base(binding)/attempt_id


def attempt_reference_valid(value):
    return (isinstance(value,dict) and set(value)=={"kind","attemptId","attemptSha256"} and
        value.get("kind")=="attempt" and valid_hex(value.get("attemptId"),32) and valid_hex(value.get("attemptSha256"),64))


def previous_reference_valid(value):
    return (value is None or attempt_reference_valid(value) or
        (isinstance(value,dict) and set(value)=={"kind","receiptSha256","executionSha256"} and
         value.get("kind")=="legacy" and valid_hex(value.get("receiptSha256"),64) and valid_hex(value.get("executionSha256"),64)))

def legacy_attempt_reference(binding):
    # One pinned historical failure, not a general path/permission override.
    if (binding["token"]!="b0c860102a494c488ead7e1b487a745c" or
        binding["sha256"]!="97c0dd1aba9ced399e6e097a491d4ee3267e460a7a93e423cce2fd33569a656a"):
        if recovery_receipt_path(binding).exists():raise GuardError("unrecognized_legacy_receipt")
        return None,None
    receipt,digest=hashed_json(recovery_receipt_path(binding))
    audit,audit_hash=hashed_json(TASK_ROOT/"evidence"/"test-resource-guard-lease-recovery-static-20261030-r3"/"recovery-execution-01.json")
    if (digest!="87a638760e643e4dd69a907c85cdc1f802b774bd42a84f61f8d3312b68bf098e" or
        audit_hash!="b0e9f9147daf29aa977561140efb6b52b7936911aac3ec32cb6d898667e4e372" or
        receipt.get("lease")!=binding or audit.get("publicExitCode")!=1 or audit.get("attempts")!=1 or
        audit.get("guardSha256","").lower()!=receipt.get("sourceSha256") or
        audit.get("requestSha256","").lower()!=receipt.get("requestSha256")):
        raise GuardError("legacy_attempt_hash_mismatch")
    protection=receipt.get("protectedBy",{})
    token=protection.get("token")
    if (token!="4c00cd728bd74d518513e536dd9f8a65" or
        protection.get("outputDir")!=str(metadata_output(token))):raise GuardError("legacy_attempt_domain_invalid")
    return {"kind":"legacy","receiptSha256":digest,"executionSha256":audit_hash},token


def attempt_load(binding, reference):
    if not attempt_reference_valid(reference):raise GuardError("attempt_reference_invalid")
    directory=attempt_directory(binding,reference["attemptId"])
    record,digest=hashed_json(directory/"attempt.json")
    required={"schemaVersion","kind","lease","attemptId","previous","recoveryToken","requestSha256","sourceSha256","command","commandSha256"}
    command=record.get("command",{});args=command.get("args") if isinstance(command,dict) else None
    # This independent copy shares the original serial/lease chain. Cleanup is
    # deliberately performed by the unchanged canonical r5 guard so that the
    # original native build can consume its resulting metadata clearance.
    canonical=Path(__file__).resolve().with_name("test-resource-guard.py")
    cleanup_paths={str(Path(__file__).resolve())}
    if (isinstance(args,list) and len(args)==5 and args[2]==str(canonical) and
        record.get("sourceSha256")=="03b55d7e561176b5c2ac6758b50e4187f3dcd175c12bc67a4012743cf3c05b0c"):
        with open(project_path(str(canonical)),"rb") as stream:canonical_bytes=stream.read(262145)
        if len(canonical_bytes)>262144 or hashlib.sha256(canonical_bytes).hexdigest()!=record["sourceSha256"]:
            raise GuardError("canonical_cleanup_source_changed")
        cleanup_paths.add(str(canonical))
    if (set(record)!=required or record.get("schemaVersion")!=1 or record.get("kind")!="lease-cleanup-attempt" or
        record.get("lease")!=binding or record.get("attemptId")!=reference["attemptId"] or digest!=reference["attemptSha256"] or
        not previous_reference_valid(record.get("previous")) or
        not valid_hex(record.get("recoveryToken"),32) or not valid_hex(record.get("requestSha256"),64) or
        not valid_hex(record.get("sourceSha256"),64) or not valid_hex(record.get("commandSha256"),64) or
        not isinstance(command,dict) or set(command)!={"executable","args"} or not isinstance(command.get("executable"),str) or
        not isinstance(args,list) or len(args)!=5 or any(not isinstance(a,str) for a in args) or args[:2]!=["-I","-B"] or
        args[2] not in cleanup_paths or args[3]!="--recover-lease" or
        value_sha256(command)!=record["commandSha256"]):raise GuardError("attempt_record_invalid")
    executable=Path(command["executable"] )
    if not executable.is_absolute() or executable.drive.upper() not in ("E:","G:") or executable.suffix.lower()!=".exe":raise GuardError("attempt_command_invalid")
    project_path(args[4])
    return {"record":record,"reference":reference,"directory":directory}


def current_attempt(binding):
    base=attempt_base(binding);project_path(str(base),False)
    pointer=base/"current-attempt.json"
    if not pointer.exists():
        if base.exists():raise GuardError("attempt_pointer_missing")
        return None
    head,_=hashed_json(pointer,4096)
    if set(head)!={"schemaVersion","lease","attempt"} or head.get("schemaVersion")!=1 or head.get("lease")!=binding:
        raise GuardError("attempt_pointer_invalid")
    return attempt_load(binding,head.get("attempt"))


def final_binding(entry, receipt_hash=None):
    value,digest=hashed_json(entry["directory"]/"final-binding.json")
    record=entry["record"];identity=value.get("verifier",{})
    if (set(value)!={"schemaVersion","kind","attempt","verifier","targetToken","receiptSha256","sourceSha256","requestSha256","commandSha256"} or
        value.get("schemaVersion")!=1 or value.get("kind")!="automatic-final-verifier" or
        value.get("attempt")!=entry["reference"] or value.get("targetToken")!=record["recoveryToken"] or
        not isinstance(identity,dict) or not valid_hex(identity.get("token"),32) or
        identity.get("outputDir")!=str(metadata_output(identity["token"])) or
        value.get("sourceSha256")!=record["sourceSha256"] or value.get("requestSha256")!=record["requestSha256"] or
        value.get("commandSha256")!=record["commandSha256"] or not valid_hex(value.get("receiptSha256"),64) or
        (receipt_hash is not None and value["receiptSha256"]!=receipt_hash)):
        raise GuardError("attempt_final_binding_invalid")
    return value,digest


def predecessor_evidence_empty(api, binding, reference):
    # Exactly one immutable predecessor; never recurse through its history.
    if attempt_reference_valid(reference):
        previous=attempt_load(binding,reference)
        old_jobs_empty(api,{"token":previous["record"]["recoveryToken"]})
        if (previous["directory"]/"final-binding.json").exists():
            final,_=final_binding(previous)
            old_jobs_empty(api,{"token":final["verifier"]["token"]})
    else:
        actual,token=legacy_attempt_reference(binding)
        if reference!=actual:raise GuardError("attempt_legacy_predecessor_changed")
        if token:old_jobs_empty(api,{"token":token})


def previous_attempt_empty(api, binding, expected):
    previous=current_attempt(binding)
    actual=previous["reference"] if previous is not None else legacy_attempt_reference(binding)[0]
    if expected!=actual:raise GuardError("attempt_predecessor_changed")
    predecessor_evidence_empty(api,binding,expected)
    return previous

def register_attempt(api, binding, request, request_hash, request_path, operation):
    # Existing shared gate is held. Exactly one predecessor, no history search.
    previous=previous_attempt_empty(api,binding,request["expectedPreviousAttempt"])
    command={"executable":str(Path(sys.executable).resolve()),
        "args":["-I","-B",str(Path(__file__).resolve()),"--recover-lease",str(request_path)]}
    record={"schemaVersion":1,"kind":"lease-cleanup-attempt","lease":binding,"attemptId":request["attemptId"],
        "previous":request["expectedPreviousAttempt"],"recoveryToken":operation["token"],"requestSha256":request_hash,
        "sourceSha256":hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),"command":command,"commandSha256":value_sha256(command)}
    base=attempt_base(binding);directory=attempt_directory(binding,request["attemptId"])
    project_path(str(directory),False);base.mkdir(parents=True,exist_ok=True);directory.mkdir(exist_ok=False)
    small_json(directory/"attempt.json",record,sync=True)
    _,digest=hashed_json(directory/"attempt.json")
    reference={"kind":"attempt","attemptId":request["attemptId"],"attemptSha256":digest}
    pending=base/("current-"+request["attemptId"]+".pending.json")
    small_json(pending,{"schemaVersion":1,"lease":binding,"attempt":reference},sync=True)
    if current_lease()["binding"]!=binding:raise GuardError("attempt_lease_changed_before_publish")
    if previous is None:
        if (base/"current-attempt.json").exists():raise GuardError("attempt_predecessor_changed_before_publish")
    elif current_attempt(binding)["reference"]!=previous["reference"]:raise GuardError("attempt_predecessor_changed_before_publish")
    os.replace(pending,base/"current-attempt.json")
    # Every later failure remains current; no old-success fallback.
    return {"record":record,"reference":reference,"directory":directory}


def request_matches_attempt(entry, state):
    record=entry["record"];request,digest=hashed_json(project_path(record["command"]["args"][4]))
    if (digest!=record["requestSha256"] or request.get("schemaVersion")!=2 or request.get("lease")!=record["lease"] or
        request.get("attemptId")!=record["attemptId"] or request.get("expectedPreviousAttempt")!=record["previous"]):
        raise GuardError("attempt_request_changed")
    return recovery_evidence(request.get("evidence"),state)


def attempt_recovery_proof(api, entry, state, domain=None):
    record=entry["record"];binding=record["lease"]
    now=current_attempt(binding)
    if now is None or now["reference"]!=entry["reference"]:raise GuardError("attempt_no_longer_current")
    if domain is None:domain=finished_domain(api,str(metadata_output(record["recoveryToken"])))
    report=domain["report"];operation=domain["operation"]
    path=entry["directory"]/"receipt.json";receipt,receipt_hash=hashed_json(path)
    if (report["token"]!=record["recoveryToken"] or report["operationKind"]!="recover" or
        report.get("sourceSha256")!=record["sourceSha256"] or operation.get("attempt")!=entry["reference"] or
        operation.get("receiptPath")!=str(path) or operation.get("receiptSha256")!=receipt_hash or
        receipt.get("schemaVersion")!=3 or receipt.get("kind")!="current-empty-cleanup-only" or receipt.get("lease")!=binding or
        receipt.get("attempt")!=entry["reference"] or receipt.get("provisional") is not True or
        receipt.get("cleanupNowConfirmed") is not False or receipt.get("doesNotVerifyOriginalRun") is not True or
        receipt.get("gatePath")!=str(GLOBAL_ROOT/"serial.lock") or
        receipt.get("requestSha256")!=record["requestSha256"] or receipt.get("sourceSha256")!=record["sourceSha256"] or
        receipt.get("commandSha256")!=record["commandSha256"] or
        receipt.get("protectedBy",{}).get("token")!=report["token"] or
        receipt.get("protectedBy",{}).get("outputDir")!=report.get("outputDir") or
        receipt.get("protectedBy",{}).get("identity")!=operation.get("identity") or
        not empty_observations_valid(receipt.get("jobs"),binding["token"])):raise GuardError("attempt_recovery_unconfirmed")
    if request_matches_attempt(entry,state)!=receipt.get("evidence"):raise GuardError("attempt_evidence_changed")
    recovery_evidence(receipt["evidence"],state)
    predecessor_evidence_empty(api,binding,record["previous"]);old_jobs_empty(api,state)
    return domain,receipt_hash


def bind_final_verifier(entry, operation, target_token, receipt_hash):
    record=entry["record"]
    if target_token!=record["recoveryToken"] or hashlib.sha256(Path(__file__).read_bytes()).hexdigest()!=record["sourceSha256"]:
        raise GuardError("attempt_final_source_or_target_changed")
    path=entry["directory"]/"final-binding.json"
    if path.exists():raise GuardError("attempt_final_already_bound")
    value={"schemaVersion":1,"kind":"automatic-final-verifier","attempt":entry["reference"],"verifier":operation,
        "targetToken":target_token,"receiptSha256":receipt_hash,"sourceSha256":record["sourceSha256"],
        "requestSha256":record["requestSha256"],"commandSha256":record["commandSha256"]}
    small_json(path,value,sync=True)
    return hashed_json(path)[1]


def attempt_clearance(api, entry, state):
    record=entry["record"];path=entry["directory"]/"command-exit.json"
    if not path.exists():raise GuardError("attempt_pending_public_exit")
    exit_receipt,_=hashed_json(path)
    if (exit_receipt.get("schemaVersion")!=1 or exit_receipt.get("kind")!="actual-public-command-exit" or
        exit_receipt.get("lease")!=record["lease"] or exit_receipt.get("attempt")!=entry["reference"] or
        exit_receipt.get("sourceSha256")!=record["sourceSha256"] or exit_receipt.get("requestSha256")!=record["requestSha256"] or
        exit_receipt.get("commandSha256")!=record["commandSha256"] or exit_receipt.get("command")!=record["command"] or
        type(exit_receipt.get("publicExitCode")) is not int or type(exit_receipt.get("attempts")) is not int or exit_receipt.get("attempts")!=1):
        raise GuardError("attempt_public_exit_binding_invalid")
    if exit_receipt["publicExitCode"]!=0:raise GuardError("attempt_public_command_failed")
    recovery,receipt_hash=attempt_recovery_proof(api,entry,state)
    binding,binding_hash=final_binding(entry,receipt_hash)
    final=finished_domain(api,binding["verifier"]["outputDir"])
    report=final["report"];operation=final["operation"]
    if (report["token"]!=binding["verifier"]["token"] or report["operationKind"]!="verify" or
        report.get("sourceSha256")!=record["sourceSha256"] or operation.get("identity")!=binding["verifier"].get("identity") or
        operation.get("attempt")!=entry["reference"] or operation.get("receiptSha256")!=receipt_hash or
        operation.get("finalBindingSha256")!=binding_hash or operation.get("targetToken")!=record["recoveryToken"] or
        operation.get("targetResultSha256")!=recovery["reportSha256"] or operation.get("targetWatchdogSha256")!=recovery["proofSha256"] or
        not empty_observations_valid(operation.get("targetJobs"),record["recoveryToken"])):
        raise GuardError("attempt_final_domain_unconfirmed")
    if current_attempt(record["lease"])["reference"]!=entry["reference"]:raise GuardError("attempt_changed_during_admission")


def remaining_previous_job(api, expected=None):
    previous=current_lease();binding=previous["binding"] if previous else None
    if expected is not None and binding!=expected:raise GuardError("previous_lease_changed")
    if previous is None:return None
    state=previous["state"]
    attempt=current_attempt(binding)
    if attempt is not None:
        attempt_clearance(api,attempt,state) # Exact current only; no old-success search.
    else:
        out=project_path(state["outputDir"])
        report,_=hashed_json(out/"result.json");proof,_=hashed_json(out/"watchdog-result.json")
        if not success_records_valid(report,proof,state):raise GuardError("previous_cleanup_unconfirmed")
        finished_domain(api,str(out),state)
    return binding


def register_lease(api, state, previous):
    # Invoked only after the same controller's native watchdog-ready event.
    actual=remaining_previous_job(api,previous)
    if actual!=previous:raise GuardError("previous_lease_changed")
    directory=GLOBAL_ROOT/"leases"
    project_path(str(directory),False);directory.mkdir(exist_ok=True)
    path=directory/(state["token"]+".json")
    state.update(schemaVersion=2,previousLease=previous)
    small_json(path,state,sync=True)
    _,digest=hashed_json(path,4096)
    pending=GLOBAL_ROOT/("lease-head-"+state["token"]+".json")
    small_json(pending,{"schemaVersion":1,"token":state["token"],"leaseSha256":digest},sync=True)
    project_path(str(GLOBAL_ROOT/"current-lease.json"),False)
    os.replace(pending,GLOBAL_ROOT/"current-lease.json")


def recover_lease(api, raw, operation):
    request_path=project_path(raw);request,request_digest=hashed_json(request_path)
    if (set(request)!={"schemaVersion","lease","attemptId","expectedPreviousAttempt","evidence"} or
        request.get("schemaVersion")!=2 or not isinstance(request.get("lease"),dict) or not valid_hex(request.get("attemptId"),32)):
        raise GuardError("recovery_attempt_request_invalid")
    previous=current_lease()
    if previous is None or previous["binding"]!=request["lease"]:raise GuardError("recovery_lease_mismatch")
    binding=previous["binding"];state=previous["state"]
    evidence=recovery_evidence(request["evidence"],state)
    # Publish immutable attempt/head before the cleanup body; later failure stays current.
    entry=register_attempt(api,binding,request,request_digest,request_path,operation)
    observations=old_jobs_empty(api,state)
    if current_lease()["binding"]!=binding:raise GuardError("recovery_lease_changed")
    if request_matches_attempt(entry,state)!=evidence:raise GuardError("recovery_evidence_changed")
    path=entry["directory"]/"receipt.json";record=entry["record"]
    receipt={"schemaVersion":3,"kind":"current-empty-cleanup-only","lease":binding,"attempt":entry["reference"],
        "evidence":evidence,"jobs":observations,"provisional":True,"cleanupNowConfirmed":False,
        "doesNotVerifyOriginalRun":True,"originalRunStatus":"failed-or-unverified","gatePath":str(GLOBAL_ROOT/"serial.lock"),
        "requestSha256":record["requestSha256"],"sourceSha256":record["sourceSha256"],"commandSha256":record["commandSha256"],
        "protectedBy":operation,"createdUtc":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())}
    small_json(path,receipt,sync=True);_,digest=hashed_json(path)
    return {"attempt":entry["reference"],"receiptPath":str(path),"receiptSha256":digest,"originalRunStatus":"failed-or-unverified"}


def metadata_worker(api, args):
    if len(args)!=20 or not sys.flags.isolated or not sys.dont_write_bytecode:
        raise GuardError("metadata_worker_arguments_invalid")
    kind,raw,token,out_raw=args[:4]
    if kind not in ("recover","verify") or not valid_hex(token,32) or out_raw!=str(metadata_output(token)):
        raise GuardError("metadata_worker_mode_invalid")
    payload,control,watch_job,ready,gate,parent,observer=[int(h) for h in args[4:11]]
    expected_parent=(int(args[11]),int(args[12]));expected_observer=(int(args[13]),int(args[14]))
    expected_target=args[15]
    if expected_target and not valid_hex(expected_target,32):raise GuardError("metadata_target_token_invalid")
    mapping,index,diagnostic_outer=int(args[16]),int(args[17]),int(args[18])
    view=diagnostic_view(api,mapping);diagnostic_attach(api,view,index,DIAG_WORKER,token)
    witness=api.diag["bank"].lanes[DIAG_OUTER].identity
    diagnostic_outer_identity=api.identity(diagnostic_outer)
    diagnostic_event(api,13,DIAG_OUTER,*diagnostic_outer_identity,handle=diagnostic_outer,
        result=diagnostic_outer_identity==(witness.pid,witness.creation))
    diagnostic_track(api,parent,DIAG_CONTROLLER,expected_parent);diagnostic_track(api,observer,DIAG_OBSERVER,expected_observer)
    diagnostic_track(api,diagnostic_outer,DIAG_OUTER,diagnostic_outer_identity)
    if not all((payload,control,watch_job,ready,gate,parent,observer)):raise GuardError("metadata_handles_invalid")
    current=api.k.GetCurrentProcess();worker_identity=api.identity(current)
    if (api.identity(parent)!=expected_parent or api.identity(observer)!=expected_observer or
        len({worker_identity[0],expected_parent[0],expected_observer[0]})!=3):
        raise GuardError("metadata_identity_mismatch")
    for job,process in ((payload,current),(control,current),(control,parent),(control,observer),(watch_job,observer)):
        api.member(job,process)
    if api.is_member(payload,parent) or api.is_member(payload,observer):raise GuardError("metadata_sibling_boundary_invalid")
    expected={payload:limits_record(96*MIB,96*MIB,1),watch_job:limits_record(WATCHDOG_LIMIT,WATCHDOG_LIMIT,1),
        control:limits_record(96*MIB,96*MIB+CONTROL_RESERVE+WATCHDOG_LIMIT,3)}
    for job,wanted in expected.items():
        limits=api.limits(job)
        if {"process":limits.process,"tree":limits.tree,"activeLimit":limits.basic.active,"flags":limits.basic.flags}!=wanted:
            raise GuardError("metadata_limits_invalid")
    if (api.k.WaitForSingleObject(ready,0)!=WAIT_OBJECT or
        api.k.WaitForSingleObject(parent,0)!=WAIT_TIMEOUT or api.k.WaitForSingleObject(observer,0)!=WAIT_TIMEOUT):
        raise GuardError("metadata_observer_not_ready")
    memory=api.memory()
    if memory["ramFree"]<RAM_FLOOR or memory["commitFree"]<COMMIT_FLOOR:raise GuardError("system_headroom_floor")
    # Only after native identity, limit, live-observer and ready checks may files be read.
    out=project_path(out_raw)
    diagnostic_jobs={"control":control,"payload":payload,"observer":watch_job}
    diagnostic_actors={DIAG_OUTER:diagnostic_outer,DIAG_CONTROLLER:parent,DIAG_OBSERVER:observer,DIAG_WORKER:current}
    diagnostic_save(api,out,"worker-start",diagnostic_jobs,diagnostic_actors)
    identity={"controllerPid":expected_parent[0],"controllerCreationTime":expected_parent[1],
        "observerPid":expected_observer[0],"observerCreationTime":expected_observer[1],
        "workerPid":worker_identity[0],"workerCreationTime":worker_identity[1]}
    operation={"token":token,"outputDir":str(out),"identity":identity}
    contract=args[19]
    if contract not in ("success","timeout") or (contract=="timeout" and (kind!="verify" or not expected_target)):
        raise GuardError("metadata_contract_invalid")
    details=(recover_lease(api,raw,operation) if kind=="recover" else
        verify_timeout(api,raw,expected_target) if contract=="timeout" else verify_finished_run(api,raw,expected_target,operation))
    result={"schemaVersion":1,"token":token,"operationKind":kind,"identity":identity,
        "outcome":"completed","verifiedSuccess":False,**details}
    small_json(out/"operation-result.json",result,sync=True)
    global _METADATA_HANDLES
    _METADATA_HANDLES=(payload,control,watch_job,ready,gate,parent,observer,mapping,diagnostic_outer)
    diagnostic_event(api,11,DIAG_WORKER,result=1)
    diagnostic_save(api,out,"worker-finish",diagnostic_jobs,diagnostic_actors)
    return 0


def drain(api, handle, stream, count):
    available=W.DWORD()
    if not api.k.PeekNamedPipe(handle,None,0,None,C.byref(available),None):
        if C.get_last_error()==109:return count
        raise GuardError("pipe_peek_failed",C.get_last_error())
    size=min(available.value,32768)
    if not size:return count
    if count+size>LOG_LIMIT:raise GuardError("log_limit")
    buffer=C.create_string_buffer(size);read=W.DWORD()
    api.check(api.k.ReadFile(handle,buffer,size,C.byref(read),None),"pipe_read_failed")
    stream.write(buffer.raw[:read.value]);stream.flush()
    return count+read.value

def fixed_fixture(spec, mode):
    fixture=Path(__file__).absolute().with_name("test-resource-guard-fixtures.py")
    if (spec["executable"]!=sys.executable or spec["cwd"]!=str(fixture.parent.parent) or
        spec["args"]!=["-I","-B",str(fixture),mode]):
        raise GuardError("fixed_fixture_required")
    return fixture


def fixed_product_command(spec):
    # Three exact offline local checks. This is not a generic command runner.
    root=Path(__file__).resolve().parent.parent
    node=r"C:\Program Files\nodejs\node.exe"
    cargo=r"C:\Users\admin\.cargo\bin\cargo.exe"
    direct_native=TASK_ROOT/"evidence/test-resource-guard-direct-native-static-20261031-r1/uagent-central-native-check.exe"
    commands={
        "integration-types":(node,["--max-old-space-size=384",str(root/"node_modules/typescript/bin/tsc"),"--noEmit","-p",str(root/"apps/desktop/web/tsconfig.current-integration.json"),"--incremental","false"],str(root)),
        "credential-offline-tests":(node,[str(root/"node_modules/vitest/vitest.mjs"),"run","--config",str(root/"apps/desktop/vitest.config.ts"),
            "web/src/runtime/native-provider-credentials.test.ts","web/src/runtime/safe-provider-session.test.ts",
            "--maxWorkers=1","--minWorkers=1","--no-file-parallelism"],str(root/"apps/desktop")),
        "central-native-tests":(str(direct_native),["runtime_host","--test-threads=1"],str(root)),
        "central-native-history-tests":(str(direct_native),["local_run_store::sqlite::history_search::tests::","--test-threads=1"],str(root)),
        "central-native-harness":(cargo,["test","--lib","runtime_host","--offline","--locked","-j1","--manifest-path",str(TASK_ROOT/"evidence/central-native-harness-20261031-r1/Cargo.toml"),"--","--test-threads=1"],str(root)),
    }
    actual=(spec["executable"],spec["args"],spec["cwd"])
    matched=[name for name,command in commands.items() if actual==command]
    if spec["profile"] not in ("product-check","narrow-check","direct-native128") or len(matched)!=1:raise GuardError("fixed_product_command_required")
    if matched[0] in ("central-native-tests","central-native-history-tests"):
        with open(direct_native,"rb") as stream:
            body=stream.read(4230657)
        if len(body)!=4230656 or hashlib.sha256(body).hexdigest()!="03ca47cdd9d1b474b5aa3ad378dcd7fca8bd5d78a5319b400c9d441f35f82ab6":
            raise GuardError("frozen_native_test_binary_changed")
    return matched[0]


def fixed_integrated_build_command(spec):
    # No caller-supplied build flags, profiles, environment, destinations or scripts.
    root=Path(__file__).resolve().parent.parent
    web=TASK_ROOT/"build-cache/integrated-20261101/web"
    bound_web=TASK_ROOT/"build-cache/integrated-20261101-r4/web"
    semi_web=TASK_ROOT/"build-cache/integrated-20261101-r5/web"
    commands={
        "integrated-web512":("integrated-web",r"C:\Program Files\nodejs\node.exe",
            ["--max-old-space-size=384",str(root/"apps/desktop/node_modules/vite/bin/vite.js"),"build",
             "--config",str(root/"apps/desktop/web/vite.config.ts"),"--outDir",str(web),"--emptyOutDir","false"],str(root/"apps/desktop")),
        "integrated-web256":("integrated-web",r"C:\Program Files\nodejs\node.exe",
            ["--max-old-space-size=256",str(root/"apps/desktop/node_modules/vite/bin/vite.js"),"build",
             "--config",str(root/"apps/desktop/web/vite.config.ts"),"--outDir",str(web),"--emptyOutDir","false",
             "--sourcemap","false"],str(root/"apps/desktop")),
        "integrated-web-serial":("integrated-web",r"C:\Program Files\nodejs\node.exe",
            ["--max-old-space-size=256",str(root/"apps/desktop/node_modules/vite/bin/vite.js"),"build",
             "--config",str(root/"apps/desktop/web/vite.config.ts"),"--outDir",str(web),"--emptyOutDir","false",
             "--sourcemap","false","--minify","false","--target","esnext"],str(root/"apps/desktop")),
        "integrated-web-bound512":("integrated-web",r"C:\Program Files\nodejs\node.exe",
            ["--max-old-space-size=256",str(root/"apps/desktop/node_modules/vite/bin/vite.js"),"build",
             "--config",str(root/"apps/desktop/web/vite.config.ts"),"--outDir",str(bound_web),"--emptyOutDir","false",
             "--sourcemap","false","--minify","false","--target","esnext"],str(root/"apps/desktop")),
        "integrated-native-bound768":("integrated-native",r"C:\Users\admin\.cargo\bin\cargo.exe",
            ["build","--bin","uagent","--offline","--locked","-j1","--features","custom-protocol",
             "--profile","integrated","--manifest-path",str(root/"apps/desktop/src-tauri/Cargo.toml")],str(root)),
        "integrated-web-semi8":("integrated-web",r"C:\Program Files\nodejs\node.exe",
            ["--max-old-space-size=256","--max-semi-space-size=8",str(root/"apps/desktop/node_modules/vite/bin/vite.js"),"build",
             "--config",str(root/"apps/desktop/web/vite.config.ts"),"--outDir",str(semi_web),"--emptyOutDir","false",
             "--sourcemap","false","--minify","false","--target","esnext"],str(root/"apps/desktop")),
        "integrated-native-bound-r5":("integrated-native",r"C:\Users\admin\.cargo\bin\cargo.exe",
            ["build","--bin","uagent","--offline","--locked","-j1","--features","custom-protocol",
             "--profile","integrated","--manifest-path",str(root/"apps/desktop/src-tauri/Cargo.toml")],str(root)),
        "managed-store-interface384":("cached-full-native-candidate",r"C:\Users\admin\.cargo\bin\cargo.exe",
            ['build', '--release', '--bin', 'uagent', '--offline', '--locked', '-j1', '--features', 'custom-protocol', '--config', 'profile.release.package.uagent.opt-level=0', '--config', 'profile.release.package.uagent.debug=0', '--config', 'profile.release.package.uagent.incremental=false', '--config', 'profile.release.package.uagent.codegen-units=256', '--config', 'profile.release.package.uagent.debug-assertions=true', '--config', 'profile.release.package.uagent.overflow-checks=true', '--manifest-path', 'E:\\Codex\\UAgent\\2026-10-29\\worktrees\\credential-vault\\apps\\desktop\\src-tauri\\Cargo.toml'],str(root)),
        "integrated-native768":("integrated-native",r"C:\Users\admin\.cargo\bin\cargo.exe",
            ["build","--bin","uagent","--offline","--locked","-j1","--features","custom-protocol",
             "--profile","integrated","--manifest-path",str(root/"apps/desktop/src-tauri/Cargo.toml")],str(root)),
    }
    entry=commands.get(spec["profile"])
    if entry is None or (spec["executable"],spec["args"],spec["cwd"])!=entry[1:]:
        raise GuardError("fixed_integrated_build_command_required")
    return entry[0]


def entered_record(api, out, launch, launch_hash):
    entered,digest=hashed_json(out/"entered.json",4096)
    expected={"schemaVersion":1,"token":launch["token"],"sourceSha256":launch["sourceSha256"],
        "launchSha256":launch_hash,"fixtureSha256":launch["fixtureSha256"],
        "subjectPid":launch["subjectPid"],"subjectCreationTime":launch["subjectCreationTime"],
        "fixtureMode":launch["fixtureMode"]}
    if entered!=expected:raise GuardError("fixture_entry_binding_invalid")
    return entered,digest


def run(api, spec_path, metadata_kind=None, metadata_raw=None, closure=None):
    if not sys.flags.isolated or not sys.dont_write_bytecode:raise GuardError("launch_python_with_I_and_B")
    if closure is None:raise GuardError("fixed_closure_required")
    token=closure["token"]
    if metadata_kind is None:
        spec=read_small(project_path(spec_path),16384)
        if set(spec)!={"schemaVersion","profile","executable","args","cwd","outputDir"} or spec["schemaVersion"]!=1:
            raise GuardError("spec_schema_invalid")
        product_name=None
        if closure["mode"] in INTEGRATED_BUILD_LIMITS:
            if spec["profile"]!=closure["mode"]:raise GuardError("fixed_integrated_profile_required")
            product_name=fixed_integrated_build_command(spec)
        elif closure["mode"] in ("product-check","narrow-check","direct-native128"):
            product_name=fixed_product_command(spec)
            if spec["profile"]!=closure["mode"] or (closure["mode"]=="narrow-check" and
                product_name not in ("integration-types","central-native-harness","central-native-tests")):
                raise GuardError("fixed_narrow_command_required")
            if closure["mode"]=="direct-native128" and product_name not in ("central-native-tests","central-native-history-tests"):
                raise GuardError("fixed_direct_native_command_required")
        elif spec["profile"] not in ("micro","micro-process","micro-tree"):raise GuardError("closure_scope_fixed_only")
        process_limit,tree_limit,active_limit,seconds,oldspace=PROFILES[spec["profile"]]
        fixture=None;fixture_mode=None
        if spec["profile"] in ("micro-process","micro-tree"):
            if closure["mode"]!="run":raise GuardError("fixture_contract_mismatch")
            fixture_mode="process-only" if spec["profile"]=="micro-process" else "tree-only"
            fixture=fixed_fixture(spec,fixture_mode)
        elif closure["mode"] in ("serial-owner","timeout-check"):
            fixture_mode="serial-owner" if closure["mode"]=="serial-owner" else "timeout-sleep"
            fixture=fixed_fixture(spec,fixture_mode)
        args=spec["args"]
        if not isinstance(args,list) or len(args)>128 or any(not isinstance(a,str) or len(a)>4000 or "\0" in a for a in args):
            raise GuardError("args_invalid")
        executable=Path(spec["executable"])
        if not executable.is_absolute() or executable.suffix.lower()!=".exe" or not executable.is_file():
            raise GuardError("executable_invalid")
        executable=executable.resolve(strict=True)
        cwd=project_path(spec["cwd"]);output=project_path(spec["outputDir"],False)
        if not cwd.is_dir() or output.exists():raise GuardError("output_exists_or_cwd_invalid")
        profile=spec["profile"];kind="run"
    else:
        if metadata_kind not in ("recover","verify"):raise GuardError("metadata_mode_invalid")
        process_limit,tree_limit,active_limit,seconds,oldspace=METADATA_PROFILE
        # Fixed self-script worker only. No spec/request/path inspection here.
        executable=Path(sys.executable);cwd=Path(__file__).absolute().parent.parent
        output=metadata_output(token);profile="metadata";kind=metadata_kind;args=[]
    control_name="Global\\UAgent.TestResourceGuard.control."+token
    payload_name="Global\\UAgent.TestResourceGuard.payload."+token
    watch_name="Global\\UAgent.TestResourceGuard.watchdog."+token
    required=tree_limit+CONTROL_RESERVE+WATCHDOG_LIMIT
    control=api.job(control_name,max(process_limit,96*MIB),required,active_limit+2)
    api.assign(control,api.k.GetCurrentProcess())
    global _CONTROL_HANDLE
    _CONTROL_HANDLE=control
    api.k.SetErrorMode(0x1|0x2|0x8000)
    initial=api.memory()
    admission=640*MIB if closure["mode"]=="serial-owner" else required
    if initial["ramFree"]<RAM_FLOOR+admission or initial["commitFree"]<COMMIT_FLOOR+admission:
        raise GuardError("insufficient_system_headroom")
    gate=payload=watch_job=stop=parent=ready_event=None
    watcher=subject=None
    handles=[];duplicates=[];pipes=[];streams=[];aux=[]
    output_created=False;previous=None
    result={"schemaVersion":1,"profile":profile,"operationKind":kind,"token":token,
        "executable":executable.name,"processLimitBytes":process_limit,"treeLimitBytes":tree_limit,
        "activeProcessLimit":active_limit,"timeoutSeconds":seconds,"logLimitPerStream":LOG_LIMIT,
        "controlJob":control_name,"payloadJob":payload_name,"watchdogJob":watch_name,"outputDir":str(output),
        "startedUtc":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"memoryInitial":initial,
        "outcome":"not_started","subjectResumed":False,"watchdogReady":False}
    try:
        if metadata_kind is None:
            GLOBAL_ROOT.mkdir(parents=True,exist_ok=True);project_path(str(GLOBAL_ROOT))
            gate=serial_gate(api,existing=(GLOBAL_ROOT/"last-lease.json").exists() or (GLOBAL_ROOT/"current-lease.json").exists())
            output.mkdir(parents=True,exist_ok=False);project_path(str(output));output_created=True
        payload=api.job(payload_name,process_limit,tree_limit,active_limit)
        watch_job=api.job(watch_name,WATCHDOG_LIMIT,WATCHDOG_LIMIT,1)
        parent=api.k.OpenProcess(0x101001,False,os.getpid());api.check(parent,"open_own_process_failed")
        parent_identity=api.identity(parent)
        if parent_identity[0]!=os.getpid():raise GuardError("own_process_identity_mismatch")
        result["controllerPid"],result["controllerCreationTime"]=parent_identity
        diagnostic_track(api,parent,DIAG_CONTROLLER,parent_identity)
        stop=api.k.CreateEventW(None,True,False,None);api.check(stop,"create_stop_failed")
        ready_event=api.k.CreateEventW(None,True,False,None);api.check(ready_event,"create_ready_failed")
        aux.append(ready_event)
        sa=Security(C.sizeof(Security),None,True)
        nul=api.k.CreateFileW("NUL",0xC0000000,3,C.byref(sa),3,0x80,None)
        if not nul or nul==INVALID:raise GuardError("open_nul_failed",C.get_last_error())
        handles.append(nul)
        gate_read=gate_write=None
        if metadata_kind is not None:
            gate_read,gate_write=api.pipe();aux.extend((gate_read,gate_write))
        for original in (payload,parent,stop,gate_read if metadata_kind else gate,control,watch_job,ready_event):
            duplicates.append(api.dup(original))
        watch_args=["-I","-B",str(Path(__file__).absolute()),"--watchdog"]+[str(h) for h in duplicates]+[
            str(seconds),str(output),token,str(parent_identity[0]),str(parent_identity[1]),kind]
        diagnostic_inherited=[api.dup(closure["mapping"]),api.dup(closure["outer"],0x101000)]
        duplicates.extend(diagnostic_inherited);watch_args.extend([str(diagnostic_inherited[0]),str(closure["diagnosticIndex"]),str(diagnostic_inherited[1])])
        watcher=api.spawn(sys.executable,watch_args,cwd,child_environment(32),(nul,nul,nul),duplicates)
        diagnostic_created(api,DIAG_OBSERVER,watcher)
        observer_identity=api.identity(watcher.process)
        result["observerPid"],result["observerCreationTime"]=observer_identity
        try:api.assign(watch_job,watcher.process);api.resume(watcher)
        except BaseException:
            api.k.TerminateProcess(watcher.process,125);raise
        for h in duplicates:api.close(h)
        duplicates.clear()
        signals=(W.HANDLE*2)(ready_event,watcher.process)
        if api.k.WaitForMultipleObjects(2,signals,False,3000)!=0:
            raise GuardError("watchdog_not_ready")
        if api.k.WaitForSingleObject(watcher.process,0)!=WAIT_TIMEOUT:raise GuardError("watchdog_not_alive")
        result["watchdogReady"]=True
        if metadata_kind is not None:
            # Readiness is native; request/gate/evidence I/O starts only here.
            gate=serial_gate(api,existing=True)
            if api.identity(watcher.process)!=observer_identity:raise GuardError("observer_identity_changed")
            api.member(watch_job,watcher.process);api.member(control,watcher.process)
            transferred=api.dup_target(gate,watcher.process)
            data=C.create_string_buffer(int(transferred).to_bytes(8,"little"));written=W.DWORD()
            api.check(api.k.WriteFile(gate_write,data,8,C.byref(written),None),"gate_transfer_write_failed")
            if written.value!=8:raise GuardError("gate_transfer_short_write")
            diagnostic_event(api,12,DIAG_CONTROLLER,result=1)
            for h in (gate_read,gate_write):api.close(h);aux.remove(h)
            output.mkdir(parents=True,exist_ok=False);project_path(str(output));output_created=True
        else:
            ready=read_small(output/"watchdog-ready.json",1024)
            if ready!={"token":token,"ready":True,"controllerPid":parent_identity[0],"controllerCreationTime":parent_identity[1]}:
                raise GuardError("watchdog_ready_invalid")
        result["sourceSha256"]=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        if metadata_kind is None and product_name is not None:
            result["fixedProductCommand"]=product_name
            result["specSha256"]=hashlib.sha256(project_path(spec_path).read_bytes()).hexdigest()
        if metadata_kind is None and fixture is not None:
            result["fixtureMode"]=fixture_mode
            result["fixtureSha256"]=hashlib.sha256(fixture.read_bytes()).hexdigest()
            result["contract"]=closure["mode"]
            args=list(args)+[str(output),token,result["sourceSha256"]]
            if profile in ("micro-process","micro-tree"):
                for h in (control,closure["stage"]):duplicates.append(api.dup(h,4))
                # Only these two fixed quota fixtures get a completion port.
                # Associate the exact inactive payload job before subject creation.
                api.bind(api.k,"CreateIoCompletionPort",W.HANDLE,W.HANDLE,W.HANDLE,C.c_size_t,W.DWORD)
                port=api.k.CreateIoCompletionPort(INVALID,None,0,1)
                api.check(port,"quota_completion_port_create_failed");aux.append(port)
                association=(C.c_void_p*2)(1,port)
                api.check(api.k.SetInformationJobObject(payload,7,C.byref(association),C.sizeof(association)),"quota_completion_port_associate_failed")
                duplicates.append(api.dup(port))
                result["quotaNotificationContract"]="exact-payload-iocp-v1"
                args.extend(str(h) for h in duplicates)
        if metadata_kind is None:
            previous=remaining_previous_job(api)
            register_lease(api,{"schemaVersion":2,"controlJob":control_name,"payloadJob":payload_name,
                "guardianPid":os.getpid(),"token":token,"outputDir":str(output)},previous)
        else:
            for handle,access in ((payload,4),(control,4),(watch_job,4),(ready_event,0x100000),
                                  (gate,0),(parent,0x101000),(watcher.process,0x101000)):
                duplicates.append(api.dup(handle,access))
            args=["-I","-B",str(Path(__file__).absolute()),"--metadata-worker",kind,metadata_raw,token,str(output)]+[
                str(h) for h in duplicates[:7]]+[str(v) for v in (*parent_identity,*observer_identity)]+[closure["expectedTarget"]]
        if metadata_kind is not None:
            diagnostic_inherited=[api.dup(closure["mapping"]),api.dup(closure["outer"],0x101000)]
            duplicates.extend(diagnostic_inherited);args.extend([str(diagnostic_inherited[0]),str(closure["diagnosticIndex"]),str(diagnostic_inherited[1]),closure["verificationContract"]])
        out_read,out_write=api.pipe();pipes.extend((out_read,out_write))
        err_read,err_write=api.pipe();pipes.extend((err_read,err_write))
        environment=child_environment(oldspace)
        if profile in INTEGRATED_BUILD_LIMITS:
            environment.update(VITE_UAGENT_ENABLE_FIXTURES="0",VITE_UAGENT_ACCEPTANCE_UI="0")
        if profile in ("integrated-web-serial","integrated-web-bound512","integrated-web-semi8"):
            # Bounded Go GC/CPU hints supplement, never replace, the OS512MiB tree cap.
            environment.update(GOMAXPROCS="1",GOGC="50",GOMEMLIMIT="192MiB")
        if profile in ("integrated-native768","integrated-native-bound768"):
            # Existing debug/release build products are preserved; profile directory is new.
            environment["TAURI_CONFIG"]=json.dumps({"build":{"frontendDist":str(TASK_ROOT/("build-cache/integrated-20261101-r4/web" if profile=="integrated-native-bound768" else "build-cache/integrated-20261101/web"))}})
        if profile=="integrated-native-bound768":
            environment["CARGO_TARGET_DIR"]=str(TASK_ROOT/"build-cache/integrated-20261101-r4/native")
        if profile=="integrated-native-bound-r5":
            environment["TAURI_CONFIG"]=json.dumps({"build":{"frontendDist":str(TASK_ROOT/"build-cache/integrated-20261101-r5/web")}})
            environment["CARGO_TARGET_DIR"]=str(TASK_ROOT/"build-cache/integrated-20261101-r5/native")
        if profile=="managed-store-interface384":
            environment["TAURI_CONFIG"]=json.dumps({"build":{"frontendDist":str(TASK_ROOT/"build-cache/integrated-20261101-r5/web")}})
        subject=api.spawn(executable,args,cwd,environment,(nul,out_write,err_write),duplicates)
        result["subjectPid"],result["subjectCreationTime"]=api.identity(subject.process)
        diagnostic_created(api,DIAG_WORKER,subject)
        try:
            api.assign(payload,subject.process);result["subjectMembershipVerified"]=True
            if api.k.WaitForSingleObject(watcher.process,0)!=WAIT_TIMEOUT:raise GuardError("watchdog_exited_before_resume")
            if metadata_kind is None and fixture is not None:
                launch={**result,"verifiedSuccess":False,"preparedForExternalVerification":False,
                    "outcome":"expected_timeout_launch" if closure["mode"]=="timeout-check" else "fixed_fixture_launch",
                    "specSha256":hashlib.sha256(project_path(spec_path).read_bytes()).hexdigest(),
                    "resumeNotYetRequested":True}
                small_json(output/"launch.json",launch,sync=True)
                _,launch_hash=hashed_json(output/"launch.json")
            publish_closure(api,closure,parent,watcher.process,subject.process,output)
            api.resume(subject);result["subjectResumed"]=True
        except BaseException:
            api.k.TerminateProcess(subject.process,125);raise
        for h in duplicates:api.close(h)
        duplicates.clear()
        api.close(out_write);api.close(err_write);pipes=[out_read,err_read]
        stdout=open(output/"stdout.log","xb");streams.append(stdout)
        stderr=open(output/"stderr.log","xb");streams.append(stderr)
        counts=[0,0];deadline=time.monotonic()+seconds
        result["minRamFree"]=initial["ramFree"];result["minCommitFree"]=initial["commitFree"]
        result["outcome"]="running"
        if metadata_kind is None and closure["mode"]=="timeout-check":
            for _ in range(40):
                if (output/"entered.json").exists():
                    entered_record(api,output,launch,launch_hash)
                    diagnostic_event(api,15,DIAG_CONTROLLER,*parent_identity,result=1)
                    # Fixed fault injection: only this controller pauses. The
                    # existing independent five-second watchdog must revoke it.
                    time.sleep(8)
                    raise GuardError("expected_watchdog_did_not_revoke")
                if api.k.WaitForSingleObject(watcher.process,0)!=WAIT_TIMEOUT:
                    raise GuardError("watchdog_exited_before_fixture_entry")
                time.sleep(.025)
            raise GuardError("fixture_entry_missing")
        while True:
            counts[0]=drain(api,out_read,stdout,counts[0]);counts[1]=drain(api,err_read,stderr,counts[1])
            now=api.memory();result["memoryLast"]=now
            result["minRamFree"]=min(result["minRamFree"],now["ramFree"])
            result["minCommitFree"]=min(result["minCommitFree"],now["commitFree"])
            if now["ramFree"]<RAM_FLOOR or now["commitFree"]<COMMIT_FLOOR:raise GuardError("system_headroom_floor")
            if time.monotonic()>=deadline:raise GuardError("timeout")
            if api.k.WaitForSingleObject(watcher.process,0)!=WAIT_TIMEOUT:raise GuardError("external_watchdog_stopped")
            if api.k.WaitForSingleObject(subject.process,0)==WAIT_OBJECT:break
            time.sleep(.1)
        result["subjectExitCode"]=api.exit_code(subject.process)
        diagnostic_event(api,8,DIAG_WORKER,result["subjectPid"],result["subjectCreationTime"],handle=subject.process,result=1,exit_code=result["subjectExitCode"])
        result["rootExitedWithDescendants"]=not api.empty(payload,.25)
        if result["rootExitedWithDescendants"]:api.check(api.k.TerminateJobObject(payload,125),"residual_termination_failed")
        if not api.empty(payload):raise GuardError("payload_exit_unconfirmed")
        for _ in range(64):
            before_counts=list(counts)
            counts[0]=drain(api,out_read,stdout,counts[0]);counts[1]=drain(api,err_read,stderr,counts[1])
            if counts==before_counts:break
        result["outputBytes"]=counts
        if metadata_kind is not None and result["subjectExitCode"]==0:
            operation,digest=hashed_json(output/"operation-result.json")
            identity={"controllerPid":parent_identity[0],"controllerCreationTime":parent_identity[1],
                "observerPid":observer_identity[0],"observerCreationTime":observer_identity[1],
                "workerPid":result["subjectPid"],"workerCreationTime":result["subjectCreationTime"]}
            if (operation.get("token")!=token or operation.get("operationKind")!=kind or
                operation.get("identity")!=identity or operation.get("outcome")!="completed"):
                raise GuardError("metadata_result_invalid")
            result["operationResultSha256"]=digest
        result["outcome"]="completed" if result["subjectExitCode"]==0 and not result["rootExitedWithDescendants"] else "subject_failed_or_residual"
    except GuardError as error:
        result["outcome"]=error.kind;result["winerror"]=error.code
    except BaseException as error:
        result["outcome"]="guardian_internal_error";result["errorType"]=type(error).__name__
    finally:
        if payload:
            try:
                if api.accounting(payload).active:api.check(api.k.TerminateJobObject(payload,125),"payload_cleanup_failed")
                result["activeZero"]=api.empty(payload)
                peaks=api.limits(payload);result["peakProcessBytes"]=peaks.peak_process;result["peakTreeBytes"]=peaks.peak_tree
            except GuardError as error:result["activeZero"]=False;result["cleanupError"]=error.kind
        for stream in streams:stream.close()
        for h in duplicates+pipes+handles+aux:api.close(h)
        for pi in (subject,watcher):
            if pi:api.close(pi.thread);api.close(pi.process)
        for h in (parent,watch_job,payload):api.close(h)
        api.close(gate) # Observer retains its exact gate duplicate through OS exit.
        prepared=(result["outcome"]=="completed" and result.get("activeZero") is True and result["watchdogReady"])
        result["preparedForExternalVerification"]=prepared;result["verifiedSuccess"]=False
        result["watchdogFinalPending"]=result["watchdogReady"]
        diagnostic_event(api,11,DIAG_CONTROLLER,result=prepared)
        if output_created:
            result["endedUtc"]=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime());small_json(output/"result.json",result)
        print(json.dumps({"outcome":result["outcome"],"verifiedSuccess":False,"operationKind":kind,
            "preparedForExternalVerification":prepared,"watchdogFinalPending":result["watchdogReady"],
            "result":str(output/"result.json") if output_created else None}),flush=True)
        if stop:api.check(api.k.SetEvent(stop),"finish_signal_failed");api.close(stop)
    return 75 if prepared else 1


def verify_finished_run(api, raw, expected_token="", verifier_operation=None):
    # Auto recovery final binds once under this inherited gate before final-body
    # checks; ordinary verify only reads an already completed current attempt.
    entry=None;binding_hash=None;bound_receipt_hash=None
    current=current_lease()
    if expected_token and current is not None:
        candidate=current_attempt(current["binding"])
        if candidate is not None and candidate["record"]["recoveryToken"]==expected_token:
            if verifier_operation is None:raise GuardError("automatic_final_context_missing")
            if raw!=str(metadata_output(expected_token)):raise GuardError("automatic_final_locator_mismatch")
            entry=candidate
            _,bound_receipt_hash=hashed_json(entry["directory"]/"receipt.json")
            binding_hash=bind_final_verifier(entry,verifier_operation,expected_token,bound_receipt_hash)
    domain=finished_domain(api,raw)
    if expected_token and domain["report"]["token"]!=expected_token:raise GuardError("verification_target_mismatch")
    details={}
    if domain["report"]["operationKind"]=="recover":
        if current is None:raise GuardError("recovery_current_lease_missing")
        active=current_attempt(current["binding"])
        if active is None or domain["operation"].get("attempt")!=active["reference"]:raise GuardError("verification_attempt_not_current")
        if expected_token:
            if entry is None or entry["reference"]!=active["reference"]:raise GuardError("automatic_final_attempt_unbound")
            _,receipt_hash=attempt_recovery_proof(api,entry,current["state"],domain)
            if receipt_hash!=bound_receipt_hash:raise GuardError("attempt_receipt_changed")
        else:
            entry=active;attempt_clearance(api,entry,current["state"])
            _,receipt_hash=hashed_json(entry["directory"]/"receipt.json")
            _,binding_hash=final_binding(entry,receipt_hash)
        details={"attempt":entry["reference"],"receiptSha256":receipt_hash,"finalBindingSha256":binding_hash}
    return {"targetToken":domain["report"]["token"],"targetResultSha256":domain["reportSha256"],
        "targetWatchdogSha256":domain["proofSha256"],"targetJobs":domain["jobs"],
        "targetVerifiedProvisional":True,**details}

def verify_timeout(api, raw, expected_token):
    # This fixed negative check never enters success_records_valid and never
    # clears the failed workload lease. Its own metadata domain must close normally.
    out=project_path(raw);launch,launch_hash=hashed_json(out/"launch.json")
    proof,proof_hash=hashed_json(out/"watchdog-result.json")
    _,entered_hash=entered_record(api,out,launch,launch_hash)
    current=current_lease()
    if (not expected_token or launch.get("token")!=expected_token or launch.get("outputDir")!=str(out) or
        launch.get("contract")!="timeout-check" or launch.get("fixtureMode")!="timeout-sleep" or
        launch.get("outcome")!="expected_timeout_launch" or launch.get("verifiedSuccess") is not False or
        launch.get("preparedForExternalVerification") is not False or launch.get("subjectResumed") is not False or
        launch.get("resumeNotYetRequested") is not True or launch.get("operationKind")!="run" or
        launch.get("subjectMembershipVerified") is not True or launch.get("watchdogReady") is not True or
        launch.get("sourceSha256")!=hashlib.sha256(Path(__file__).read_bytes()).hexdigest() or
        proof.get("sourceSha256")!=launch.get("sourceSha256") or
        not valid_hex(launch.get("fixtureSha256"),64) or not valid_hex(launch.get("specSha256"),64) or
        current is None or current["state"].get("token")!=expected_token or
        current["state"].get("guardianPid")!=launch.get("controllerPid") or
        current["state"].get("outputDir")!=str(out)):
        raise GuardError("timeout_launch_invalid")
    identities={}
    for role in ("controller","observer","subject"):
        identity=(launch.get(role+"Pid"),launch.get(role+"CreationTime"))
        if any(type(v) is not int or v<=0 for v in identity):raise GuardError("timeout_identity_invalid")
        identities[role]=identity
    if len({v[0] for v in identities.values()})!=3:raise GuardError("timeout_identity_invalid")
    if any(proof.get(k)!=launch.get(k) for k in
        ("token","operationKind","controllerPid","controllerCreationTime","observerPid","observerCreationTime")):
        raise GuardError("timeout_proof_identity_invalid")
    if any(launch.get(role+"Job")!="Global\\UAgent.TestResourceGuard."+role+"."+expected_token
           for role in ("control","payload","watchdog")):raise GuardError("timeout_job_invalid")
    if (launch.get("profile"),launch.get("processLimitBytes"),launch.get("treeLimitBytes"),
        launch.get("activeProcessLimit"),launch.get("timeoutSeconds"))!=("micro",48*MIB,64*MIB,3,5):
        raise GuardError("timeout_profile_invalid")
    checks=(proof.get("reason")=="timeout",proof.get("terminated") is True,
        proof.get("controllerTerminationRequested") is True,proof.get("controllerExitCode")==124,
        proof.get("cleanupConfirmed") is True,proof.get("controllerExitConfirmed") is True,
        proof.get("controlOnlyObserver") is True,proof.get("activeZero") is True,
        proof.get("requiresExternalConfirmation") is False,proof.get("controlTerminationPlanned") is False,
        proof.get("gateTransferred") is True,proof.get("readyNativeConfirmed") is True)
    expected={"payload":limits_record(48*MIB,64*MIB,3),"control":limits_record(96*MIB,320*MIB,5),
        "observer":limits_record(96*MIB,96*MIB,1)}
    if (not all(checks) or not rundown_record_valid(proof) or proof.get("startupLimits")!=expected or
        proof.get("startupMemberships")!={"controllerInControl":True,"observerInControl":True,"observerInOwnJob":True} or
        proof.get("memoryInitial",{}).get("ramFree",0)<RAM_FLOOR+320*MIB or
        proof.get("memoryInitial",{}).get("commitFree",0)<COMMIT_FLOOR+320*MIB or
        proof.get("minRamFree",0)<RAM_FLOOR or proof.get("minCommitFree",0)<COMMIT_FLOOR):
        raise GuardError("timeout_cleanup_unconfirmed")
    # Stage0 original-handle exits, checked releases and complete empty rundown
    # are available in the existing shared bank; no new observer is introduced.
    banks=diagnostic_banks(api)
    if len(banks)!=2:raise GuardError("timeout_original_closure_missing")
    first=banks[0];lane=first["lanes"][DIAG_OUTER];events=lane["events"]
    if (not first["stableBytes"] or not first["token"]["valid"] or first["token"]["text"]!=expected_token or
        not first["packetAccepted"] or lane["overflow"] or not any(e[0]==9 and e[6]==1 for e in events) or
        any(e[0]==10 for e in events)):raise GuardError("timeout_original_closure_missing")
    controller_lane=first["lanes"][DIAG_CONTROLLER]
    fault=[e for e in controller_lane["events"] if e[0]==15 and e[1]==DIAG_CONTROLLER and
        (e[2],e[4])==identities["controller"] and e[6]==1]
    if controller_lane["overflow"] or len(fault)!=1:raise GuardError("timeout_controller_fault_not_entered")
    for role,name in ((DIAG_CONTROLLER,"controller"),(DIAG_OBSERVER,"observer"),(DIAG_WORKER,"subject")):
        pid,creation=identities[name]
        exited=[e for e in events if e[0]==8 and e[1]==role and e[2]==pid and e[4]==creation]
        closed=[e for e in events if e[0]==4 and e[1]==role and e[2]==pid and e[4]==creation]
        if (len(exited)!=1 or exited[0][6]!=1 or exited[0][8]!=124 or
            len(closed)!=1 or closed[0][6]!=1):raise GuardError("timeout_original_closure_missing")
    details={"schemaVersion":1,"targetToken":expected_token,"sourceSha256":launch["sourceSha256"],
        "targetLaunchSha256":launch_hash,"targetWatchdogSha256":proof_hash,"targetEnteredSha256":entered_hash,
        "targetJobs":old_jobs_empty(api,{"token":expected_token}),"checkPassed":False,
        "protectionObserved":True,"operationSucceeded":False,"cleanupVerified":True,
        "publicExitPending":True,"expectedPublicExitCode":74}
    small_json(out/"timeout-check.json",details,sync=True)
    return details


def gate_controller(api, args):
    # Exactly one fixed gate attempt under the original native closer. No payload,
    # observer, lease registration, filesystem walk or retry is permitted here.
    if len(args)!=7 or not sys.flags.isolated or not sys.dont_write_bytecode:
        raise GuardError("gate_controller_arguments_invalid")
    raw,token=args[:2];outer,stage,pipe=[int(v) for v in args[2:5]]
    expected_outer=(int(args[5]),int(args[6]))
    if not valid_hex(token,32) or api.identity(outer)!=expected_outer or api.k.WaitForSingleObject(outer,0)!=WAIT_TIMEOUT:
        raise GuardError("gate_controller_identity_invalid")
    current=api.k.GetCurrentProcess();identity=api.identity(current);api.member(stage,current)
    limits=api.limits(stage)
    if (api.is_member(stage,outer) or
        {"process":limits.process,"tree":limits.tree,"activeLimit":limits.basic.active,"flags":limits.basic.flags}!=limits_record(96*MIB,96*MIB,1)):
        raise GuardError("gate_controller_limits_invalid")
    memory=api.memory()
    if memory["ramFree"]<RAM_FLOOR+640*MIB or memory["commitFree"]<COMMIT_FLOOR+640*MIB:
        raise GuardError("insufficient_combined_headroom")
    request=read_small(project_path(raw),4096)
    if set(request)!={"schemaVersion","ownerOutputDir","outputDir"} or request["schemaVersion"]!=1:
        raise GuardError("gate_request_invalid")
    owner=project_path(request["ownerOutputDir"]);out=project_path(request["outputDir"],False)
    if owner==out or out.exists():raise GuardError("gate_output_invalid")
    launch,launch_hash=hashed_json(owner/"launch.json")
    _,entered_hash=entered_record(api,owner,launch,launch_hash)
    source_hash=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    before=current_lease()
    if (launch.get("contract")!="serial-owner" or launch.get("fixtureMode")!="serial-owner" or
        launch.get("sourceSha256")!=source_hash or before is None or
        before["state"].get("token")!=launch.get("token") or
        before["state"].get("outputDir")!=str(owner) or before["state"].get("guardianPid")!=launch.get("controllerPid")):
        raise GuardError("gate_owner_binding_invalid")
    refusal=None
    try:
        gate=serial_gate(api,existing=True)
    except GuardError as error:
        if error.kind!="serial_busy" or error.code not in (32,33):raise
        refusal=error.code
    else:
        diagnostic_checked_close(api,gate,"unexpected_gate_close_failed")
        raise GuardError("expected_gate_refusal_missing")
    after=current_lease()
    if after!=before:raise GuardError("gate_owner_lease_changed")
    out.mkdir(parents=True,exist_ok=False);project_path(str(out))
    small_json(out/"gate-refusal.json",{"schemaVersion":1,"token":token,"sourceSha256":source_hash,
        "controllerPid":identity[0],"controllerCreationTime":identity[1],"ownerToken":launch["token"],
        "ownerLaunchSha256":launch_hash,"ownerEnteredSha256":entered_hash,
        "ownerLeaseBefore":before["binding"],"ownerLeaseAfter":after["binding"],"winerror":refusal,
        "gatePath":str(GLOBAL_ROOT/"serial.lock"),"payloadCreated":False,"leaseRegistered":False,
        "checkPassed":False,"operationSucceeded":False,"cleanupVerified":False,"provisional":True,
        "expectedPublicExitCode":73,"memoryInitial":memory},sync=True)
    packet=ClosurePacket();packet.magic=0x33474155;packet.version=1;packet.reserved=73
    packet.token=token.encode("ascii");packet.output=str(out)
    packet.controllerPid,packet.controllerCreation=identity
    count=W.DWORD()
    api.check(api.k.WriteFile(pipe,C.byref(packet),C.sizeof(packet),C.byref(count),None),"gate_packet_write_failed")
    if count.value!=C.sizeof(packet):raise GuardError("gate_packet_short")
    return 73


def gate_entry(api, raw):
    # A branch of the existing native closer, not an additional supervision layer.
    # Only native calls and fixed packet data occur in this root; the child does
    # bounded request/evidence I/O. Root+controller are capped at192MiB/two processes.
    if not sys.flags.isolated or not sys.dont_write_bytecode:return diagnostic_exit(1)
    handles={};success=False;phase=2;failure=diagnostic_exit(2)
    try:
        family=api.job("Global\\UAgent.TestResourceGuard.gate-closer."+uuid.uuid4().hex,96*MIB,192*MIB,2)
        api.assign(family,api.k.GetCurrentProcess())
        global _CLOSURE_HANDLE
        _CLOSURE_HANDLE=family;api.k.SetErrorMode(0x1|0x2|0x8000)
        phase=3;memory=api.memory()
        shortage=(1 if memory["ramFree"]<RAM_FLOOR+640*MIB else 0)|(2 if memory["commitFree"]<COMMIT_FLOOR+640*MIB else 0)
        if shortage:return diagnostic_exit(54,shortage)
        phase=11
        handles["stage"]=api.job("Global\\UAgent.TestResourceGuard.gate-stage."+uuid.uuid4().hex,96*MIB,96*MIB,1)
        phase=4
        handles["outer"]=api.k.OpenProcess(0x101000,False,os.getpid());api.check(handles["outer"],"gate_open_self_failed")
        identity=api.identity(handles["outer"]);token=uuid.uuid4().hex
        sa=Security(C.sizeof(Security),None,True)
        handles["nul"]=api.k.CreateFileW("NUL",0xC0000000,3,C.byref(sa),3,0x80,None)
        if not handles["nul"] or handles["nul"]==INVALID:raise GuardError("gate_nul_failed")
        handles["read"],handles["write"]=api.pipe()
        for source,name,access in (("outer","outerCopy",0x101000),("stage","stageCopy",4),("write","pipeCopy",0)):
            handles[name]=api.dup(handles[source],access)
        inherited=[handles[k] for k in ("outerCopy","stageCopy","pipeCopy")]
        phase=13
        args=["-I","-B",str(Path(__file__).absolute()),"--gate-controller",raw,token]+[
            str(h) for h in inherited]+[str(v) for v in identity]
        pi=api.spawn(sys.executable,args,Path(__file__).absolute().parent.parent,
            child_environment(32),(handles["nul"],)*3,inherited)
        handles["controller"]=pi.process;handles["thread"]=pi.thread
        original=api.identity(pi.process);api.assign(handles["stage"],pi.process);api.member(family,pi.process)
        phase=14
        if api.k.ResumeThread(pi.thread)==0xffffffff:raise GuardError("gate_resume_failed",C.get_last_error())
        closure_release(api,handles,"thread")
        for name in ("outerCopy","stageCopy","pipeCopy","write"):closure_release(api,handles,name)
        deadline=time.monotonic()+5;packet=None;post_exit_peek=False;phase=15
        while time.monotonic()<deadline:
            memory=api.memory()
            if memory["ramFree"]<RAM_FLOOR or memory["commitFree"]<COMMIT_FLOOR:raise GuardError("system_headroom_floor")
            available=W.DWORD()
            if packet is None:
                if not api.k.PeekNamedPipe(handles["read"],None,0,None,C.byref(available),None):
                    native_error=C.get_last_error()
                    if native_error==109 and api.k.WaitForSingleObject(handles["controller"],0)==WAIT_OBJECT:
                        raise GuardError("gate_controller_without_packet",api.exit_code(handles["controller"]))
                    raise GuardError("gate_packet_unavailable",native_error)
                if available.value>C.sizeof(ClosurePacket):raise GuardError("gate_packet_overflow")
            if packet is None and available.value==C.sizeof(ClosurePacket):
                packet=ClosurePacket();count=W.DWORD()
                api.check(api.k.ReadFile(handles["read"],C.byref(packet),C.sizeof(packet),C.byref(count),None),"gate_packet_read_failed")
                if (count.value!=C.sizeof(packet) or packet.magic!=0x33474155 or packet.version!=1 or packet.reserved!=73 or
                    packet.token.decode("ascii")!=token or not packet.output or
                    (packet.controllerPid,packet.controllerCreation)!=original or
                    any((packet.observerPid,packet.workerPid,packet.observerCreation,packet.workerCreation,
                        packet.observerHandle,packet.workerHandle))):raise GuardError("gate_packet_invalid")
            signal=api.k.WaitForSingleObject(handles["controller"],100)
            if signal==WAIT_OBJECT:
                phase=16
                if packet is None:
                    # One final bounded Peek/Read after the original exit. A
                    # packet may be written between the preceding Peek and wait.
                    if post_exit_peek:raise GuardError("gate_controller_without_packet",api.exit_code(handles["controller"]))
                    post_exit_peek=True;continue
                if api.exit_code(handles["controller"])!=73:raise GuardError("gate_exit_unconfirmed")
                closure_release(api,handles,"controller")
                phase=17
                closure_stage_empty(api,handles["stage"]);closure_release(api,handles,"stage")
                success=True;break
            if signal!=WAIT_TIMEOUT:raise GuardError("gate_wait_failed")
        if not success:raise GuardError("gate_closure_timeout")
    except BaseException as error:
        success=False;failure=diagnostic_failure(error,phase)
        if handles.get("stage"):
            api.k.TerminateJobObject(handles["stage"],124)
            if handles.get("controller"):api.k.WaitForSingleObject(handles["controller"],1000)
    finally:
        for name in tuple(handles):
            try:closure_release(api,handles,name)
            except BaseException as error:
                if success:failure=diagnostic_failure(error,18)
                success=False
    return 73 if success else failure


def closure_release(api, handles, name):
    value=handles.get(name)
    if value==INVALID:
        handles[name]=None;raise GuardError("closure_invalid_handle")
    if value:
        handles[name]=None # Never retry a failed explicit close.
        diagnostic_checked_close(api,value,"closure_close_failed")


def closure_stage_empty(api, job):
    deadline=time.monotonic()+1
    while True:
        snapshot=api.job_snapshot(job);ids=snapshot["pidList"]
        if not ids["complete"]:raise GuardError("closure_pid_list_incomplete")
        if snapshot["active"]==0:
            if ids["assigned"]!=0 or ids["listed"]!=0 or ids["pids"]!=[]:
                raise GuardError("closure_empty_inconsistent")
            return
        if time.monotonic()>=deadline:raise GuardError("closure_rundown_unconfirmed")
        time.sleep(.1)


def publish_closure(api, closure, controller, observer, subject, output):
    # Publish only duplicates of original creation handles, never PID lookups.
    if len(str(output))>1000:raise GuardError("closure_output_too_long")
    packet=ClosurePacket();packet.magic=0x33474155;packet.version=1
    packet.reserved=74 if closure["mode"]=="timeout-check" else 0
    packet.controllerPid,packet.controllerCreation=api.identity(controller)
    packet.observerPid,packet.observerCreation=api.identity(observer)
    packet.workerPid,packet.workerCreation=api.identity(subject)
    packet.observerHandle=api.dup_target(observer,closure["outer"],0x101000)
    packet.workerHandle=api.dup_target(subject,closure["outer"],0x101000)
    packet.token=closure["token"].encode("ascii");packet.output=str(output)
    diagnostic_packet(api,packet)
    count=W.DWORD()
    api.check(api.k.WriteFile(closure["pipe"],C.byref(packet),C.sizeof(packet),C.byref(count),None),"closure_publish_failed")
    if count.value!=C.sizeof(packet):raise GuardError("closure_publish_short")
    # Retain inherited handles until controller OS exit, including this pipe;
    # no disk/JSON/hash/old-job check is delegated to the outer closer.


def controller_entry(api, args):
    if len(args)!=11 or not sys.flags.isolated or not sys.dont_write_bytecode:
        raise GuardError("controller_arguments_invalid")
    kind,raw,token,expected_target=args[:4]
    outer,pipe,stage=[int(h) for h in args[4:7]];expected_outer=(int(args[7]),int(args[8]))
    if (kind not in ("run","recover","verify","serial-owner","timeout-check","timeout-final","product-check","narrow-check","direct-native128")+tuple(INTEGRATED_BUILD_LIMITS) or not valid_hex(token,32) or
        (expected_target and not valid_hex(expected_target,32))):raise GuardError("controller_mode_invalid")
    if api.identity(outer)!=expected_outer or api.k.WaitForSingleObject(outer,0)!=WAIT_TIMEOUT:
        raise GuardError("closure_parent_identity_invalid")
    api.member(stage,api.k.GetCurrentProcess())
    if api.is_member(stage,outer):raise GuardError("closure_parent_boundary_invalid")
    limits=api.limits(stage)
    expected_stage=limits_record(*INTEGRATED_BUILD_LIMITS[kind][0]) if kind in INTEGRATED_BUILD_LIMITS else limits_record(128*MIB,384*MIB,10) if kind=="direct-native128" else limits_record(512*MIB,768*MIB,10) if kind=="narrow-check" else limits_record(512*MIB,896*MIB,10) if kind=="product-check" else limits_record(96*MIB,352*MIB,5)
    if {"process":limits.process,"tree":limits.tree,"activeLimit":limits.basic.active,"flags":limits.basic.flags}!=expected_stage:
        raise GuardError("closure_stage_limits_invalid")
    mapping,index=int(args[9]),int(args[10])
    view=diagnostic_view(api,mapping);diagnostic_attach(api,view,index,DIAG_CONTROLLER,token)
    diagnostic_track(api,outer,DIAG_OUTER,expected_outer)
    workload=kind in ("run","serial-owner","timeout-check","product-check","narrow-check","direct-native128") or kind in INTEGRATED_BUILD_LIMITS
    closure={"token":token,"expectedTarget":expected_target,"outer":outer,"pipe":pipe,"stage":stage,"mapping":mapping,"diagnosticIndex":index,
        "mode":kind,"verificationContract":"timeout" if kind=="timeout-final" else "success"}
    return run(api,raw if workload else None,None if workload else "verify" if kind=="timeout-final" else kind,raw,closure)


def closure_stage(api, family, outer, outer_identity, kind, raw, expected_target, seconds, nul, diagnostic_mapping, diag_address, index):
    # Fixed native closer: anonymous-pipe metadata and raw original handles only.
    # No paths are inspected here, no JSON/hash is read, and no old job is opened.
    handles={};success=False;target_output=None;deadline=time.monotonic()+seconds;phase=11
    api.closure_failure=diagnostic_exit(phase)
    try:
        stage_limits=INTEGRATED_BUILD_LIMITS[kind][0] if kind in INTEGRATED_BUILD_LIMITS else (128*MIB,384*MIB,10) if kind=="direct-native128" else (512*MIB,768*MIB,10) if kind=="narrow-check" else (512*MIB,896*MIB,10) if kind=="product-check" else (96*MIB,352*MIB,5)
        handles["stage"]=api.job("Global\\UAgent.TestResourceGuard.closer-stage."+uuid.uuid4().hex,*stage_limits)
        phase=12
        handles["read"],handles["write"]=api.pipe()
        handles["parentCopy"]=api.dup(outer,0x101040)
        handles["stageCopy"]=api.dup(handles["stage"],4)
        handles["pipeCopy"]=api.dup(handles["write"])
        token=uuid.uuid4().hex
        diagnostic_attach(api,diag_address,index,DIAG_OUTER,token,True,outer_identity)
        diagnostic_track(api,outer,DIAG_OUTER,outer_identity)
        handles["mapCopy"]=api.dup(diagnostic_mapping)
        inherited=[handles[k] for k in ("parentCopy","pipeCopy","stageCopy","mapCopy")]
        args=["-I","-B",str(Path(__file__).absolute()),"--controller",kind,raw,token,expected_target]+[
            str(h) for h in inherited[:3]]+[str(v) for v in outer_identity]+[str(handles["mapCopy"]),str(index)]
        phase=13
        pi=api.spawn(sys.executable,args,Path(__file__).absolute().parent.parent,
            child_environment(32),(nul,nul,nul),inherited)
        handles["controller"]=pi.process;handles["thread"]=pi.thread
        controller_identity=api.identity(pi.process)
        diagnostic_created(api,DIAG_CONTROLLER,pi)
        api.assign(handles["stage"],pi.process);api.member(family,pi.process)
        phase=14
        if api.k.ResumeThread(pi.thread)==0xffffffff:raise GuardError("closure_resume_failed",C.get_last_error())
        closure_release(api,handles,"thread")
        for key in ("parentCopy","stageCopy","pipeCopy","mapCopy","write"):closure_release(api,handles,key)
        packet=None;codes={};unexpected_exit=None;phase=15
        while time.monotonic()<deadline:
            memory=api.memory()
            if memory["ramFree"]<RAM_FLOOR or memory["commitFree"]<COMMIT_FLOOR:raise GuardError("system_headroom_floor")
            if packet is None:
                available=W.DWORD()
                if not api.k.PeekNamedPipe(handles["read"],None,0,None,C.byref(available),None):
                    native_error=C.get_last_error()
                    if native_error==109 and api.k.WaitForSingleObject(handles["controller"],0)==WAIT_OBJECT:
                        raise GuardError("closure_controller_without_packet",api.exit_code(handles["controller"]))
                    raise GuardError("closure_packet_unavailable",native_error)
                if available.value>C.sizeof(ClosurePacket):raise GuardError("closure_packet_overflow")
                if available.value==C.sizeof(ClosurePacket):
                    candidate=ClosurePacket();count=W.DWORD()
                    api.check(api.k.ReadFile(handles["read"],C.byref(candidate),C.sizeof(candidate),C.byref(count),None),"closure_packet_read_failed")
                    diagnostic_packet(api,candidate,received=True,received_bytes=count.value)
                    if (count.value!=C.sizeof(candidate) or candidate.magic!=0x33474155 or candidate.version!=1 or
                        candidate.token.decode("ascii")!=token or not candidate.output or
                        candidate.reserved!=(74 if kind=="timeout-check" else 0) or
                        (candidate.controllerPid,candidate.controllerCreation)!=controller_identity):
                        raise GuardError("closure_packet_invalid")
                    for name,h,identity in (("observer",candidate.observerHandle,(candidate.observerPid,candidate.observerCreation)),
                                            ("worker",candidate.workerHandle,(candidate.workerPid,candidate.workerCreation))):
                        if not h or h==INVALID or api.identity(h)!=identity or identity[0] in (outer_identity[0],controller_identity[0]):
                            raise GuardError("closure_child_identity_invalid")
                        api.member(handles["stage"],h);handles[name]=h
                        diagnostic_track(api,h,DIAG_OBSERVER if name=="observer" else DIAG_WORKER,identity)
                    if candidate.observerPid==candidate.workerPid:raise GuardError("closure_children_not_distinct")
                    packet=candidate;diagnostic_packet(api,candidate,True);closure_release(api,handles,"read")
                elif api.k.WaitForSingleObject(handles["controller"],0)==WAIT_OBJECT:
                    raise GuardError("closure_controller_without_packet",api.exit_code(handles["controller"]))
                else:
                    signal=api.k.WaitForSingleObject(handles["controller"],100)
                    if signal not in (WAIT_OBJECT,WAIT_TIMEOUT):raise GuardError("closure_wait_failed",C.get_last_error())
                    continue
            # Release each confirmed exited original immediately. Waiting for
            # the observer before releasing the exited controller would retain
            # a reference through the observer's exact accounting-rundown check.
            phase=16
            expected_codes=(("worker",124),("controller",124),("observer",124)) if kind=="timeout-check" else (("worker",0),("controller",75),("observer",0))
            for key,expected in expected_codes:
                if handles.get(key):
                    signal=api.k.WaitForSingleObject(handles[key],0)
                    if signal==WAIT_OBJECT:
                        code=api.exit_code(handles[key])
                        role={"worker":DIAG_WORKER,"controller":DIAG_CONTROLLER,"observer":DIAG_OBSERVER}[key]
                        witness=api.diag["bank"].lanes[role].identity
                        diagnostic_event(api,8,role,witness.pid,witness.creation,handle=handles[key],result=1,exit_code=code)
                        # Preserve controller/observer final recorders within the
                        # existing deadline after a failure. Cache and release the
                        # exited original now so accounting can converge; success
                        # still requires every original expected code unchanged.
                        if code!=expected and unexpected_exit is None:unexpected_exit=code
                        closure_release(api,handles,key);codes[key]=code
                    elif signal!=WAIT_TIMEOUT:raise GuardError("closure_wait_failed",C.get_last_error())
            if len(codes)!=3:
                live=[handles[k] for k in ("worker","controller","observer") if handles.get(k)]
                if not live:raise GuardError("closure_exit_observation_missing")
                signal=api.k.WaitForMultipleObjects(len(live),(W.HANDLE*len(live))(*live),False,100)
                if signal==0xffffffff:raise GuardError("closure_wait_failed",C.get_last_error())
                continue
            # Only cached original-handle exits75/0/0 and all checked closes reach
            # complete fixed-buffer own-stage rundown. No observer-reference cycle.
            phase=17
            closure_stage_empty(api,handles["stage"] )
            diagnostic_event(api,9,DIAG_OUTER,result=1)
            closure_release(api,handles,"stage")
            if unexpected_exit is not None:raise GuardError("closure_exit_codes_failed",unexpected_exit)
            target_output=(packet.output,token);success=True;break
        if not success:raise GuardError("closure_timeout")
    except BaseException as error:
        success=False;api.closure_failure=diagnostic_failure(error,phase)
        diagnostic_event(api,10,DIAG_OUTER,result=0)
        if handles.get("stage"):
            # Owned stage only: never terminate an old named job or a PID search.
            api.k.TerminateJobObject(handles["stage"],124)
            end=time.monotonic()+3
            while time.monotonic()<end:
                active=[handles[k] for k in ("controller","observer","worker") if handles.get(k)]
                if not active:break
                signal=api.k.WaitForMultipleObjects(len(active),(W.HANDLE*len(active))(*active),True,100)
                if signal==WAIT_OBJECT:break
                if signal!=WAIT_TIMEOUT:break
    finally:
        for key in tuple(handles):
            try:closure_release(api,handles,key)
            except BaseException as error:
                if success:api.closure_failure=diagnostic_failure(error,18)
                success=False
    return target_output if success else None


def close_command(api, kind, raw):
    # Final public exit authority. Fixed96MiB/process,448MiB/tree,6 processes.
    # Initial scope is normal micro plus the two fixed metadata modes only.
    # No disk/stdout/JSON/hash/old-job I/O is performed by this native closer.
    if kind not in ("run","recover","verify","serial-owner","timeout-check","product-check","narrow-check","direct-native128")+tuple(INTEGRATED_BUILD_LIMITS) or not sys.flags.isolated or not sys.dont_write_bytecode:return diagnostic_exit(1)
    handles={};success=False;diag_address=None;phase=2;failure=diagnostic_exit(2)
    try:
        family_limits=INTEGRATED_BUILD_LIMITS[kind][1] if kind in INTEGRATED_BUILD_LIMITS else (128*MIB,480*MIB,11) if kind=="direct-native128" else (512*MIB,864*MIB,11) if kind=="narrow-check" else (512*MIB,992*MIB,11) if kind=="product-check" else (96*MIB,448*MIB,6)
        family=api.job("Global\\UAgent.TestResourceGuard.closer."+uuid.uuid4().hex,*family_limits)
        api.assign(family,api.k.GetCurrentProcess())
        global _CLOSURE_HANDLE
        _CLOSURE_HANDLE=family # OS-exit closes the sole family owner on a crash.
        api.k.SetErrorMode(0x1|0x2|0x8000)
        phase=3;memory=api.memory()
        budget=INTEGRATED_BUILD_LIMITS[kind][1][1] if kind in INTEGRATED_BUILD_LIMITS else (480 if kind=="direct-native128" else 864 if kind=="narrow-check" else 992 if kind=="product-check" else 640 if kind=="serial-owner" else 448)*MIB
        shortage=(1 if memory["ramFree"]<RAM_FLOOR+budget else 0)|(2 if memory["commitFree"]<COMMIT_FLOOR+budget else 0)
        if shortage:return diagnostic_exit(54,shortage) # No child stage/process has been created.
        phase=4
        handles["outer"]=api.k.OpenProcess(0x101040,False,os.getpid());api.check(handles["outer"],"closure_open_self_failed")
        outer_identity=api.identity(handles["outer"] )
        phase=5
        handles["diagnosticMap"]=api.k.CreateFileMappingW(INVALID,None,4,0,DIAG_BYTES,None)
        api.check(handles["diagnosticMap"],"diagnostic_mapping_failed")
        diag_address=diagnostic_view(api,handles["diagnosticMap"] )
        phase=6;sa=Security(C.sizeof(Security),None,True)
        handles["nul"]=api.k.CreateFileW("NUL",0xC0000000,3,C.byref(sa),3,0x80,None)
        if not handles["nul"] or handles["nul"]==INVALID:raise GuardError("closure_nul_failed",C.get_last_error())
        phase=7
        first=closure_stage(api,family,handles["outer"],outer_identity,kind,raw,"",INTEGRATED_BUILD_LIMITS[kind][2] if kind in INTEGRATED_BUILD_LIMITS else 75 if kind in ("product-check","narrow-check","direct-native128") else 15 if kind in ("run","serial-owner","timeout-check") else 20,handles["nul"],handles["diagnosticMap"],diag_address,0)
        if first is None:failure=api.closure_failure
        if first is not None:
            if kind=="verify":success=True
            else:
                # Exactly one protected verifier of the completed target; it is
                # closed by these original handles, never followed by verify-of-verify.
                phase=8
                success=closure_stage(api,family,handles["outer"],outer_identity,"timeout-final" if kind=="timeout-check" else "verify",first[0],first[1],20,handles["nul"],handles["diagnosticMap"],diag_address,1) is not None
                if not success:failure=api.closure_failure
    except BaseException as error:
        success=False;failure=diagnostic_failure(error,phase)
    finally:
        for key in tuple(handles):
            try:closure_release(api,handles,key)
            except BaseException as error:
                if success:failure=diagnostic_failure(error,9)
                success=False
        api.diag=None
        if diag_address:
            if not api.k.UnmapViewOfFile(diag_address):
                if success:failure=diagnostic_exit(10,C.get_last_error())
                success=False
    return (74 if kind=="timeout-check" else 0) if success else failure


def main():
    internal=len(sys.argv)>1 and sys.argv[1] in ("--watchdog","--metadata-worker","--controller")
    try:
        api=Native()
        if len(sys.argv)>1 and sys.argv[1]=="--watchdog":return watchdog(api,sys.argv[2:])
        if len(sys.argv)>1 and sys.argv[1]=="--metadata-worker":return metadata_worker(api,sys.argv[2:])
        if len(sys.argv)>1 and sys.argv[1]=="--controller":return controller_entry(api,sys.argv[2:])
        if len(sys.argv)==3 and sys.argv[1]=="--recover-lease":return close_command(api,"recover",sys.argv[2])
        if len(sys.argv)==3 and sys.argv[1]=="--verify":return close_command(api,"verify",sys.argv[2])
        if len(sys.argv)==3 and sys.argv[1] in ("--serial-owner","--timeout-check","--product-check","--narrow-check","--direct-native128")+tuple("--"+name for name in INTEGRATED_BUILD_LIMITS):
            return close_command(api,sys.argv[1][2:],sys.argv[2])
        if len(sys.argv)==3 and sys.argv[1]=="--gate-entry":return gate_entry(api,sys.argv[2])
        if len(sys.argv)>1 and sys.argv[1]=="--gate-controller":return gate_controller(api,sys.argv[2:])
        if len(sys.argv)!=2:return diagnostic_exit(1)
        return close_command(api,"run",sys.argv[1])
    except GuardError as error:
        if internal:print(json.dumps({"outcome":error.kind,"winerror":error.code,"verifiedSuccess":False}))
        return diagnostic_failure(error,19)
    except BaseException as error:
        if internal:print(json.dumps({"outcome":"bootstrap_error","errorType":type(error).__name__,"verifiedSuccess":False}))
        return diagnostic_failure(error,19)

if __name__=="__main__":
    sys.exit(main())
