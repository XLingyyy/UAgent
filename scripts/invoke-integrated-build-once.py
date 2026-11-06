"""Metadata-only one-shot caller. Test work runs only in the reviewed public guard."""
import ctypes as C
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import time
import uuid
from ctypes import wintypes as W

ROOT=Path(r"E:\Codex\UAgent\2026-10-29\worktrees\credential-vault")
EVIDENCE=Path(r"E:\Codex\UAgent\2026-10-29\evidence\integrated-product-20261101-r5")
GUARD=ROOT/"scripts/test-resource-guard.py"
FIXTURE=ROOT/"scripts/test-resource-guard-fixtures.py"
EXPECTED_GUARD="03b55d7e561176b5c2ac6758b50e4187f3dcd175c12bc67a4012743cf3c05b0c"
EXPECTED_FIXTURE="a72fe8fd008fe3cf978be1c82dfe6de9d6a232321152f53df0bf7e8de6d70038"
PYTHON=Path(r"E:\anaconda\python.exe")
HELPER=ROOT/"scripts/integrated-build-binding.py"
EXPECTED_HELPER="f740a4a07bfc04f343e2046bd65d8c38c87bc700566d13d9a8c065403f6fd2e9"
WEB_ROOT=ROOT.parents[1]/"build-cache/integrated-20261101-r5/web"

def digest(path):
    with open(path,"rb") as stream:
        body=stream.read(262145)
    if len(body)>262144:raise RuntimeError("caller input bound")
    return hashlib.sha256(body).hexdigest()

if not sys.flags.isolated or not sys.dont_write_bytecode:
    raise RuntimeError("isolated caller required")
if digest(GUARD)!=EXPECTED_GUARD or digest(FIXTURE)!=EXPECTED_FIXTURE or digest(HELPER)!=EXPECTED_HELPER:
    raise RuntimeError("frozen source changed")
spec=importlib.util.spec_from_file_location("reviewed_guard_caller",GUARD)
g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
api=g.Native()
binding_spec=importlib.util.spec_from_file_location("fixed_build_binding",HELPER)
b=importlib.util.module_from_spec(binding_spec);binding_spec.loader.exec_module(b)
CALLER_SHA=digest(Path(__file__))

def save(path,value):
    body=json.dumps(value,separators=(",",":"),ensure_ascii=True).encode()
    if len(body)>16384:raise RuntimeError("caller receipt bound")
    with open(path,"xb") as stream:
        stream.write(body);stream.flush()
        g.os.fsync(stream.fileno())

def load(path):
    return g.read_small(path,16384)


def frozen_sources_current():
    if (digest(GUARD),digest(FIXTURE),digest(HELPER),digest(Path(__file__))) != (EXPECTED_GUARD,EXPECTED_FIXTURE,EXPECTED_HELPER,CALLER_SHA):
        b.fail("binding_runner_sources_changed")


def candidate_refusal(name, stage, error, payload_created):
    code=error.args[0] if isinstance(error,b.BindingError) and error.args else "binding_unavailable"
    if not isinstance(code,str) or not code.replace("_", "").isalnum() or len(code)>96:
        code="binding_unavailable"
    record={"schemaVersion":1,"case":name,"stage":stage,"outcome":code,"payloadCreated":payload_created,
        "candidateEligible":False,"historicalBuildAndCleanupResultsPreserved":True}
    save(EVIDENCE/(name+"-binding-refusal-"+str(time.time_ns())+".json"),record)
    print(json.dumps(record));return 4


def web_proof():
    frozen_sources_current()
    web_spec=load(EVIDENCE/"web-spec.json")
    if (web_spec.get("profile")!="integrated-web-semi8" or
        web_spec.get("outputDir")!=str(EVIDENCE/"web-run-01") or
        g.fixed_integrated_build_command(web_spec)!="integrated-web"):
        b.fail("binding_web_command_invalid")
    invocation=b.read_json(EVIDENCE/"web-invocation.json",16384)
    receipt=b.read_json(EVIDENCE/"web-command-exit.json",16384)
    assessment=b.read_json(EVIDENCE/"web-assessment.json",16384)
    report=b.read_json(EVIDENCE/"web-run-01/result.json",16384)
    proof=b.read_json(EVIDENCE/"web-run-01/watchdog-result.json",16384)
    expected_command={"executable":str(PYTHON),"args":["-I","-B",str(GUARD),"--integrated-web-semi8",str(EVIDENCE/"web-spec.json")]}
    if (invocation.get("command")!=expected_command or invocation.get("guardSha256")!=EXPECTED_GUARD or
        invocation.get("fixtureSha256")!=EXPECTED_FIXTURE or invocation.get("callerSha256")!=CALLER_SHA or
        invocation.get("helperSha256")!=EXPECTED_HELPER or invocation.get("specSha256")!=digest(EVIDENCE/"web-spec.json") or
        invocation.get("maximumInvocations")!=1 or invocation.get("expectedPublicExitCode")!=0 or
        invocation.get("rootCreatedSuspended") is not True or invocation.get("nativeCreationFlags")!="0x0008040C"):
        b.fail("binding_web_invocation_invalid")
    for observed in (receipt,assessment):
        if (observed.get("actualPublicExitCode")!=0 or observed.get("expectedPublicExitCode")!=0 or
            observed.get("invocations")!=1 or observed.get("originalRootExitObserved") is not True or
            observed.get("originalThreadCheckedClose") is not True or observed.get("originalRootCheckedClose") is not True or
            any(type(observed.get(key)) is not int or observed[key]<=0 or observed[key]!=invocation.get(key)
                for key in ("rootPid","rootCreationTime"))):
            b.fail("binding_web_original_exit_invalid")
    if (not g.success_records_valid(report,proof) or report.get("sourceSha256")!=EXPECTED_GUARD or
        report.get("profile")!="integrated-web-semi8" or report.get("fixedProductCommand")!="integrated-web" or
        report.get("outputDir")!=str(EVIDENCE/"web-run-01") or report.get("specSha256")!=digest(EVIDENCE/"web-spec.json") or
        any(assessment.get(key) is not True for key in ("checkPassed","operationSucceeded","cleanupVerified")) or
        assessment.get("mainToken")!=report.get("token") or assessment.get("fixedProductCommand")!="integrated-web" or
        assessment.get("resultSha256")!=digest(EVIDENCE/"web-run-01/result.json") or
        assessment.get("watchdogSha256")!=digest(EVIDENCE/"web-run-01/watchdog-result.json")):
        b.fail("binding_web_success_proof_invalid")
    manifest_sha=b.metadata_digest(EVIDENCE/"frontend-input-inventory.json")
    if invocation.get("frontendInputInventorySha256")!=manifest_sha:
        b.fail("binding_web_prelaunch_input_invalid")
    return report


def frontend_references():
    names={"webAssessmentSha256":"web-assessment.json","webCommandExitSha256":"web-command-exit.json",
        "webInvocationSha256":"web-invocation.json","webResultSha256":"web-run-01/result.json",
        "webWatchdogSha256":"web-run-01/watchdog-result.json","webSpecSha256":"web-spec.json",
        "frontendInputInventorySha256":"frontend-input-inventory.json","frontendArtifactManifestSha256":"frontend-artifacts.json"}
    return {key:b.metadata_digest(EVIDENCE/path) for key,path in names.items()}


def publish_frontend_binding():
    inputs=b.verify_inputs(ROOT,EVIDENCE/"frontend-source",EVIDENCE/"frontend-input-inventory.json")
    artifacts,_=b.snapshot_artifacts(WEB_ROOT,EVIDENCE/"frontend-artifacts",EVIDENCE/"frontend-artifacts.json")
    report=web_proof();memory=b.peak_verdict(report)
    binding={"schemaVersion":1,"kind":"fixed-frontend-candidate-binding","candidateEligible":memory["eligible"],
        "guardSha256":EXPECTED_GUARD,"callerSha256":CALLER_SHA,"helperSha256":EXPECTED_HELPER,
        "webRoot":str(WEB_ROOT),"webOperationToken":report["token"],"sourceTreeSha256":inputs["treeSha256"],
        "artifactTreeSha256":artifacts["treeSha256"],"proofReferences":frontend_references(),"memoryTelemetry":memory,
        "sourceBoundary":b.BOUNDARY,"sourceFiles":len(inputs["files"]),"artifactFiles":len(artifacts["files"]),
        "dependencyBytesSnapshotted":False,"workspaceSnapshotAtomicAgainstHostileEdits":False}
    save(EVIDENCE/"frontend-binding.json",binding)
    return binding


def verify_frontend_binding():
    binding=b.read_json(EVIDENCE/"frontend-binding.json",16384)
    if (binding.get("schemaVersion")!=1 or binding.get("kind")!="fixed-frontend-candidate-binding" or
        binding.get("candidateEligible") is not True or binding.get("guardSha256")!=EXPECTED_GUARD or
        binding.get("callerSha256")!=CALLER_SHA or binding.get("helperSha256")!=EXPECTED_HELPER or
        binding.get("webRoot")!=str(WEB_ROOT) or binding.get("sourceBoundary")!=b.BOUNDARY):
        b.fail("binding_frontend_candidate_not_ready")
    report=web_proof();memory=b.peak_verdict(report)
    if not memory["eligible"] or binding.get("memoryTelemetry")!=memory or binding.get("webOperationToken")!=report["token"]:
        b.fail("binding_web_peak_telemetry_unaccepted")
    inputs=b.verify_inputs(ROOT,EVIDENCE/"frontend-source",EVIDENCE/"frontend-input-inventory.json")
    artifacts=b.verify_artifacts(WEB_ROOT,EVIDENCE/"frontend-artifacts",EVIDENCE/"frontend-artifacts.json")
    references=frontend_references()
    if (references!=binding.get("proofReferences") or binding.get("sourceTreeSha256")!=inputs["treeSha256"] or
        binding.get("artifactTreeSha256")!=artifacts["treeSha256"] or binding.get("sourceFiles")!=len(inputs["files"]) or
        binding.get("artifactFiles")!=len(artifacts["files"])):
        b.fail("binding_frontend_evidence_changed")
    return {**references,"frontendBindingSha256":b.metadata_digest(EVIDENCE/"frontend-binding.json"),
        "frontendSourceTreeSha256":inputs["treeSha256"],"frontendArtifactTreeSha256":artifacts["treeSha256"]}


def main():
    if len(sys.argv)!=2 or sys.argv[1] not in ("cleanup","web","native"):
        return 2
    name=sys.argv[1];spec_path=EVIDENCE/("cleanup-request.json" if name=="cleanup" else name+"-spec.json")
    expected_exit=0
    registration=EVIDENCE/(name+"-invocation.json")
    receipt_path=EVIDENCE/(name+"-command-exit.json")
    if registration.exists() or receipt_path.exists():
        raise RuntimeError("one-shot invocation already registered")
    value=load(spec_path);out=EVIDENCE/"cleanup-no-payload" if name=="cleanup" else Path(value["outputDir"])
    if name=="cleanup":
        lease=g.current_lease()
        if lease is None or lease["binding"]!=value["lease"] or g.current_attempt(lease["binding"]) is not None:
            raise RuntimeError("cleanup previous binding changed")
    memory=api.memory()
    budget_mib={"cleanup":512,"web":928,"native":1312}[name]
    if memory["ramFree"]<g.RAM_FLOOR+budget_mib*g.MIB or memory["commitFree"]<g.COMMIT_FLOOR+budget_mib*g.MIB:
        refusal={"schemaVersion":1,"case":name,"outcome":"fresh_caller_family_headroom_refused","memory":memory,
            "wholeBudgetMiB":budget_mib,"ramFloorGiB":4,"commitFloorGiB":8,"payloadCreated":False}
        save(EVIDENCE/(name+"-preflight-refusal-"+str(time.time_ns())+".json"),refusal)
        print(json.dumps(refusal));return 3
    if out.exists():raise RuntimeError("unique target output required")
    frontend_before=None;input_inventory_sha=None
    if name in ("web","native"):
        expected_profile={"web":"integrated-web-semi8","native":"integrated-native-bound-r5"}[name]
        if (value.get("profile")!=expected_profile or value.get("outputDir")!=str(EVIDENCE/(name+"-run-01")) or
            g.fixed_integrated_build_command(value)!="integrated-"+name):
            return candidate_refusal(name,"before-root",b.BindingError("binding_exact_build_profile_required"),False)
        try:
            frozen_sources_current()
            if name=="web":
                if WEB_ROOT.exists():b.fail("binding_fresh_frontend_directory_required")
                _,input_inventory_sha=b.snapshot_inputs(ROOT,EVIDENCE/"frontend-source",EVIDENCE/"frontend-input-inventory.json")
            else:
                if (ROOT.parents[1]/"build-cache/integrated-20261101-r5/native").exists():
                    b.fail("binding_fresh_native_directory_required")
                frontend_before=verify_frontend_binding()
        except BaseException as error:
            return candidate_refusal(name,"before-root",error,False)

    args=["-I","-B",str(GUARD)]+(["--recover-lease",str(spec_path)] if name=="cleanup" else ["--"+value["profile"],str(spec_path)])
    nul=None;pi=None;identity=None;thread_closed=False;process_closed=False
    started=time.time_ns();actual=None;exited=False;resumed=False
    try:
        sa=g.Security(C.sizeof(g.Security),None,True)
        nul=api.k.CreateFileW("NUL",0xC0000000,3,C.byref(sa),3,0x80,None)
        if not nul or nul==g.INVALID:raise RuntimeError("caller NUL failed")
        pi=api.spawn(PYTHON,args,ROOT,g.child_environment(32),(nul,nul,nul))
        identity=api.identity(pi.process)
        save(registration,{"schemaVersion":1,"case":name,"guardSha256":EXPECTED_GUARD,
            "fixtureSha256":EXPECTED_FIXTURE,"specSha256":digest(spec_path),
            "callerSha256":CALLER_SHA,"helperSha256":EXPECTED_HELPER,
            "frontendInputInventorySha256":input_inventory_sha,"frontendBindingBeforeNative":frontend_before,
            "command":{"executable":str(PYTHON),"args":args},
            "rootPid":identity[0],"rootCreationTime":identity[1],
            "rootCreatedSuspended":True,"nativeCreationFlags":"0x0008040C",
            "expectedPublicExitCode":expected_exit,"maximumInvocations":1,"registeredEpochNs":started})
        if api.k.ResumeThread(pi.thread)==0xffffffff:
            raise RuntimeError("caller resume failed")
        resumed=True
        g.diagnostic_checked_close(api,pi.thread,"caller_thread_close_failed")
        pi.thread=None;thread_closed=True
        end=time.monotonic()+430
        signal=g.WAIT_TIMEOUT
        while time.monotonic()<end and signal==g.WAIT_TIMEOUT:
            signal=api.k.WaitForSingleObject(pi.process,1000)
        if signal!=g.WAIT_OBJECT:raise RuntimeError("caller original root exit unconfirmed")
        actual=api.exit_code(pi.process);exited=True
        g.diagnostic_checked_close(api,pi.process,"caller_process_close_failed")
        pi.process=None;process_closed=True
    finally:
        if pi is not None:
            if pi.process and not resumed:
                api.k.TerminateProcess(pi.process,125)
                api.k.WaitForSingleObject(pi.process,1000)
            if pi.thread:api.close(pi.thread)
            if pi.process:api.close(pi.process)
        if nul:g.diagnostic_checked_close(api,nul,"caller_nul_close_failed")
    result={"schemaVersion":1,"case":name,"actualPublicExitCode":actual,
        "expectedPublicExitCode":expected_exit,"invocations":1,"rootPid":identity[0],
        "rootCreationTime":identity[1],"originalRootExitObserved":exited,
        "originalThreadCheckedClose":thread_closed,"originalRootCheckedClose":process_closed,
        "elapsedMs":(time.time_ns()-started)/1000000,"checkPassed":False,
        "operationSucceeded":False,"cleanupVerified":False}
    save(receipt_path,result)
    if actual!=expected_exit:
        if actual&0xff000000==g.DIAGNOSTIC_TAG:
            result["diagnosticPhase"]=(actual>>16)&255;result["diagnosticDetail"]=actual&65535
        print(json.dumps(result));return 1
    if name=="cleanup":
        lease=g.current_lease()
        if lease is None or lease["binding"]!=value["lease"]:raise RuntimeError("cleanup lease changed")
        entry=g.current_attempt(lease["binding"])
        if entry is None or entry["record"]["attemptId"]!=value["attemptId"]:raise RuntimeError("cleanup attempt missing")
        record=entry["record"]
        if record["command"]!={"executable":str(PYTHON),"args":args} or record["sourceSha256"]!=EXPECTED_GUARD or record["requestSha256"]!=digest(spec_path):
            raise RuntimeError("actual cleanup command binding invalid")
        save(entry["directory"]/"command-exit.json",{"schemaVersion":1,"kind":"actual-public-command-exit",
            "lease":record["lease"],"attempt":entry["reference"],"sourceSha256":record["sourceSha256"],
            "requestSha256":record["requestSha256"],"commandSha256":record["commandSha256"],"command":record["command"],
            "publicExitCode":actual,"attempts":1,"originalRootPid":result["rootPid"],
            "originalRootCreationTime":result["rootCreationTime"],"originalRootExitObserved":exited,
            "originalRootCheckedClose":process_closed,"originalThreadCheckedClose":thread_closed,
            "actualCallerReceiptSha256":digest(receipt_path),"actualCallerInvocationSha256":digest(registration)})
        assessment={**result,"checkPassed":True,"operationSucceeded":False,"cleanupVerified":True,
            "originalRunStatus":"failed-or-unverified","attempt":entry["reference"],
            "requestSha256":digest(spec_path),"freshMemoryBeforeCaller":memory}
        save(EVIDENCE/(name+"-assessment.json"),assessment)
        print(json.dumps(assessment));return 0
    report=load(out/"result.json");proof=load(out/"watchdog-result.json")
    if not g.success_records_valid(report,proof):
        raise RuntimeError("strict successful domain records invalid")
    fixed_names={"web":"integrated-web","native":"integrated-native"}
    if (report.get("profile")!=value["profile"] or report.get("sourceSha256")!=EXPECTED_GUARD or
        report.get("fixedProductCommand")!=fixed_names[name] or report.get("specSha256")!=digest(spec_path)):
        raise RuntimeError("fixed product source/input binding invalid")
    assessment={**result,"checkPassed":True,"operationSucceeded":True,"cleanupVerified":True,
        "mainToken":report["token"],"fixedProductCommand":fixed_names[name],
        "resultSha256":digest(out/"result.json"),"watchdogSha256":digest(out/"watchdog-result.json"),
        "minimumRamGiB":min(report["minRamFree"],proof["minRamFree"])/g.GIB,
        "minimumCommitFreeGiB":min(report["minCommitFree"],proof["minCommitFree"])/g.GIB}
    assessment.update(scope="protected-build-and-cleanup",memoryTelemetry=b.peak_verdict(report),
        frontendBindingBeforeNative=frontend_before)
    save(EVIDENCE/(name+"-assessment.json"),assessment)
    try:
        frozen_sources_current()
        if name=="web":
            binding=publish_frontend_binding()
            candidate={"schemaVersion":1,"case":name,"publicBuildExit":actual,"cleanupVerified":True,
                "candidateEligible":binding["candidateEligible"],"frontendBindingSha256":b.metadata_digest(EVIDENCE/"frontend-binding.json"),
                "frontendInputInventorySha256":b.metadata_digest(EVIDENCE/"frontend-input-inventory.json"),
                "frontendArtifactManifestSha256":b.metadata_digest(EVIDENCE/"frontend-artifacts.json"),
                "memoryTelemetry":binding["memoryTelemetry"]}
        else:
            frontend_after=verify_frontend_binding()
            if frontend_after!=frontend_before:b.fail("binding_frontend_changed_during_native_build")
            executable=ROOT.parents[1]/"build-cache/integrated-20261101-r5/native/integrated/uagent.exe"
            size,exe_sha=b.file_digest(executable,128*1024*1024)
            candidate={"schemaVersion":1,"case":name,"publicBuildExit":actual,"cleanupVerified":True,
                "candidateEligible":assessment["memoryTelemetry"]["eligible"],"executable":str(executable),
                "executableBytes":size,"executableSha256":exe_sha,"frontendBinding":frontend_after,
                "memoryTelemetry":assessment["memoryTelemetry"],"betaOrUiAcceptanceComplete":False}
        save(EVIDENCE/(name+"-candidate-assessment.json"),candidate)
        print(json.dumps(candidate));return 0 if candidate["candidateEligible"] else 5
    except BaseException as error:
        return candidate_refusal(name,"after-build-public-exit",error,True)

if __name__=="__main__":
    sys.exit(main())
