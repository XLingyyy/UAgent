param(
    [Parameter(Mandatory = $true)]
    [string]$Executable,

    [Parameter(Mandatory = $true)]
    [string]$WorkingDirectory,

    [Parameter(Mandatory = $true)]
    [string]$ArgumentsBase64,

    [Parameter(Mandatory = $true)]
    [string]$StdoutPath,

    [Parameter(Mandatory = $true)]
    [string]$StderrPath,

    [Parameter(Mandatory = $true)]
    [string]$TaskMarker,

    [Parameter(Mandatory = $true)]
    [string]$IdentityPath,

    [Parameter(Mandatory = $true)]
    [string]$Session,

    [Parameter(Mandatory = $true)]
    [int]$Generation,

    [Parameter(Mandatory = $true)]
    [int]$TimeoutMilliseconds
)

$ErrorActionPreference = "Stop"

$source = @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Management;
using System.Runtime.InteropServices;
using System.Text;

namespace UAgent.Mvp15D
{
    public sealed class ProcessRecord
    {
        public uint Pid { get; set; }
        public uint ParentPid { get; set; }
        public string CreationFileTimeUtc { get; set; }
        public string ExecutablePath { get; set; }
        public string CommandLine { get; set; }
        public bool IdentityComplete { get; set; }
        public bool JobMembershipVerified { get; set; }
        public bool JobNewProcessObserved { get; set; }
        public int FirstObservationSequence { get; set; }
        public string FirstObservedAt { get; set; }
        public bool ExitObserved { get; set; }
        public int ExitSequence { get; set; }
        public string ExitedAt { get; set; }
        public int? ExitCode { get; set; }
        public string ExitKind { get; set; }

        internal IntPtr ProcessHandle;
        internal bool OwnsProcessHandle;
    }

    public sealed class JobRunResult
    {
        public string SchemaVersion { get; set; }
        public string TaskMarker { get; set; }
        public string JobName { get; set; }
        public ProcessRecord Launcher { get; set; }
        public uint RootPid { get; set; }
        public int? RootExitCode { get; set; }
        public bool ActiveProcessZeroObserved { get; set; }
        public string ActiveProcessZeroObservedAt { get; set; }
        public bool TimedOut { get; set; }
        public bool ForcedJobTermination { get; set; }
        public bool ForcedUnassignedRootTermination { get; set; }
        public bool UnassignedRootResidualAfterCleanup { get; set; }
        public uint ResidualCountBeforeCleanup { get; set; }
        public uint FinalResidualCount { get; set; }
        public uint AccountingTotalProcessCount { get; set; }
        public int UnexpectedJobMessageCount { get; set; }
        public string FailureCode { get; set; }
        public List<ProcessRecord> Processes { get; set; }
    }

    public static class WindowsJobRunner
    {
        private const uint CREATE_SUSPENDED = 0x00000004;
        private const uint CREATE_NO_WINDOW = 0x08000000;
        private const uint STARTF_USESTDHANDLES = 0x00000100;
        private const uint GENERIC_READ = 0x80000000;
        private const uint GENERIC_WRITE = 0x40000000;
        private const uint FILE_SHARE_READ = 0x00000001;
        private const uint FILE_SHARE_WRITE = 0x00000002;
        private const uint FILE_SHARE_DELETE = 0x00000004;
        private const uint CREATE_NEW = 1;
        private const uint OPEN_EXISTING = 3;
        private const uint FILE_ATTRIBUTE_NORMAL = 0x00000080;
        private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x00001000;
        private const uint SYNCHRONIZE = 0x00100000;
        private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
        private const int JobObjectBasicAccountingInformation = 1;
        private const int JobObjectAssociateCompletionPortInformation = 7;
        private const int JobObjectExtendedLimitInformation = 9;
        private const uint JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO = 4;
        private const uint JOB_OBJECT_MSG_NEW_PROCESS = 6;
        private const uint JOB_OBJECT_MSG_EXIT_PROCESS = 7;
        private const uint JOB_OBJECT_MSG_ABNORMAL_EXIT_PROCESS = 8;
        private const int ERROR_ALREADY_EXISTS = 183;
        private const int WAIT_TIMEOUT = 258;
        private const uint STILL_ACTIVE = 259;
        private static readonly IntPtr INVALID_HANDLE_VALUE = new IntPtr(-1);

        [StructLayout(LayoutKind.Sequential)]
        private struct SECURITY_ATTRIBUTES
        {
            public uint nLength;
            public IntPtr lpSecurityDescriptor;
            [MarshalAs(UnmanagedType.Bool)]
            public bool bInheritHandle;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct STARTUPINFO
        {
            public uint cb;
            public string lpReserved;
            public string lpDesktop;
            public string lpTitle;
            public uint dwX;
            public uint dwY;
            public uint dwXSize;
            public uint dwYSize;
            public uint dwXCountChars;
            public uint dwYCountChars;
            public uint dwFillAttribute;
            public uint dwFlags;
            public ushort wShowWindow;
            public ushort cbReserved2;
            public IntPtr lpReserved2;
            public IntPtr hStdInput;
            public IntPtr hStdOutput;
            public IntPtr hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PROCESS_INFORMATION
        {
            public IntPtr hProcess;
            public IntPtr hThread;
            public uint dwProcessId;
            public uint dwThreadId;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct FILETIME
        {
            public uint dwLowDateTime;
            public uint dwHighDateTime;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PROCESS_BASIC_INFORMATION
        {
            public IntPtr Reserved1;
            public IntPtr PebBaseAddress;
            public IntPtr Reserved2_0;
            public IntPtr Reserved2_1;
            public IntPtr UniqueProcessId;
            public IntPtr InheritedFromUniqueProcessId;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IO_COUNTERS
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_ASSOCIATE_COMPLETION_PORT
        {
            public IntPtr CompletionKey;
            public IntPtr CompletionPort;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
        {
            public long TotalUserTime;
            public long TotalKernelTime;
            public long ThisPeriodTotalUserTime;
            public long ThisPeriodTotalKernelTime;
            public uint TotalPageFaultCount;
            public uint TotalProcesses;
            public uint ActiveProcesses;
            public uint TotalTerminatedProcesses;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetInformationJobObject(
            IntPtr hJob,
            int JobObjectInfoClass,
            IntPtr lpJobObjectInfo,
            uint cbJobObjectInfoLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool QueryInformationJobObject(
            IntPtr hJob,
            int JobObjectInfoClass,
            IntPtr lpJobObjectInfo,
            uint cbJobObjectInfoLength,
            IntPtr lpReturnLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool IsProcessInJob(
            IntPtr ProcessHandle,
            IntPtr JobHandle,
            [MarshalAs(UnmanagedType.Bool)] out bool Result);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool TerminateJobObject(IntPtr hJob, uint uExitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr CreateIoCompletionPort(
            IntPtr FileHandle,
            IntPtr ExistingCompletionPort,
            UIntPtr CompletionKey,
            uint NumberOfConcurrentThreads);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetQueuedCompletionStatus(
            IntPtr CompletionPort,
            out uint lpNumberOfBytesTransferred,
            out UIntPtr lpCompletionKey,
            out IntPtr lpOverlapped,
            uint dwMilliseconds);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CreateProcess(
            string lpApplicationName,
            StringBuilder lpCommandLine,
            IntPtr lpProcessAttributes,
            IntPtr lpThreadAttributes,
            [MarshalAs(UnmanagedType.Bool)] bool bInheritHandles,
            uint dwCreationFlags,
            IntPtr lpEnvironment,
            string lpCurrentDirectory,
            ref STARTUPINFO lpStartupInfo,
            out PROCESS_INFORMATION lpProcessInformation);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint ResumeThread(IntPtr hThread);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(
            uint dwDesiredAccess,
            [MarshalAs(UnmanagedType.Bool)] bool bInheritHandle,
            uint dwProcessId);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetProcessTimes(
            IntPtr hProcess,
            out FILETIME lpCreationTime,
            out FILETIME lpExitTime,
            out FILETIME lpKernelTime,
            out FILETIME lpUserTime);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool QueryFullProcessImageName(
            IntPtr hProcess,
            uint dwFlags,
            StringBuilder lpExeName,
            ref uint lpdwSize);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool TerminateProcess(IntPtr hProcess, uint uExitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

        [DllImport("ntdll.dll")]
        private static extern int NtQueryInformationProcess(
            IntPtr ProcessHandle,
            int ProcessInformationClass,
            ref PROCESS_BASIC_INFORMATION ProcessInformation,
            int ProcessInformationLength,
            out int ReturnLength);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateFile(
            string lpFileName,
            uint dwDesiredAccess,
            uint dwShareMode,
            ref SECURITY_ATTRIBUTES lpSecurityAttributes,
            uint dwCreationDisposition,
            uint dwFlagsAndAttributes,
            IntPtr hTemplateFile);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseHandle(IntPtr hObject);

        private static string IsoNow()
        {
            return DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
        }

        private static ulong FileTimeValue(FILETIME value)
        {
            return ((ulong)value.dwHighDateTime << 32) | value.dwLowDateTime;
        }

        private static string QuoteArgument(string value)
        {
            if (value.Length > 0 && value.IndexOfAny(new char[] { ' ', '\t', '\n', '\v', '"' }) < 0)
            {
                return value;
            }
            StringBuilder result = new StringBuilder();
            result.Append('"');
            int backslashes = 0;
            foreach (char current in value)
            {
                if (current == '\\')
                {
                    backslashes++;
                    continue;
                }
                if (current == '"')
                {
                    result.Append('\\', backslashes * 2 + 1);
                    result.Append('"');
                    backslashes = 0;
                    continue;
                }
                result.Append('\\', backslashes);
                backslashes = 0;
                result.Append(current);
            }
            result.Append('\\', backslashes * 2);
            result.Append('"');
            return result.ToString();
        }

        private static string BuildCommandLine(string executable, string[] arguments)
        {
            StringBuilder commandLine = new StringBuilder(QuoteArgument(executable));
            foreach (string argument in arguments)
            {
                commandLine.Append(' ');
                commandLine.Append(QuoteArgument(argument));
            }
            return commandLine.ToString();
        }

        private static void SetJobStruct<T>(IntPtr job, int informationClass, T value)
            where T : struct
        {
            int size = Marshal.SizeOf(typeof(T));
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(value, buffer, false);
                if (!SetInformationJobObject(job, informationClass, buffer, (uint)size))
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "SET_JOB_INFORMATION_FAILED");
                }
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }

        private static JOBOBJECT_BASIC_ACCOUNTING_INFORMATION JobAccounting(
            IntPtr job)
        {
            int size = Marshal.SizeOf(typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION));
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try
            {
                if (!QueryInformationJobObject(
                    job,
                    JobObjectBasicAccountingInformation,
                    buffer,
                    (uint)size,
                    IntPtr.Zero))
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "QUERY_JOB_FAILED");
                }
                JOBOBJECT_BASIC_ACCOUNTING_INFORMATION value =
                    (JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)Marshal.PtrToStructure(
                        buffer,
                        typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION));
                return value;
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }

        private static uint ActiveProcessCount(IntPtr job)
        {
            return JobAccounting(job).ActiveProcesses;
        }

        private static uint TotalProcessCount(IntPtr job)
        {
            return JobAccounting(job).TotalProcesses;
        }

        private static uint ParentProcessId(IntPtr processHandle)
        {
            PROCESS_BASIC_INFORMATION information = new PROCESS_BASIC_INFORMATION();
            int returned;
            int status = NtQueryInformationProcess(
                processHandle,
                0,
                ref information,
                Marshal.SizeOf(typeof(PROCESS_BASIC_INFORMATION)),
                out returned);
            if (status != 0)
            {
                return 0;
            }
            long value = information.InheritedFromUniqueProcessId.ToInt64();
            return value > 0 && value <= UInt32.MaxValue ? (uint)value : 0;
        }

        private static string QueryCommandLine(uint pid)
        {
            try
            {
                using (ManagementObjectSearcher searcher = new ManagementObjectSearcher(
                    "root\\CIMV2",
                    "SELECT CommandLine FROM Win32_Process WHERE ProcessId = " +
                        pid.ToString(CultureInfo.InvariantCulture)))
                {
                    foreach (ManagementObject item in searcher.Get())
                    {
                        object value = item["CommandLine"];
                        return value == null ? "" : Convert.ToString(value, CultureInfo.InvariantCulture);
                    }
                }
            }
            catch
            {
                return "";
            }
            return "";
        }

        private static ProcessRecord InspectProcess(
            IntPtr processHandle,
            bool ownsProcessHandle,
            uint pid,
            IntPtr job,
            string commandLineFallback,
            int sequence,
            bool newProcessObserved)
        {
            ProcessRecord record = new ProcessRecord();
            record.Pid = pid;
            record.FirstObservationSequence = sequence;
            record.FirstObservedAt = IsoNow();
            record.JobNewProcessObserved = newProcessObserved;
            record.ProcessHandle = processHandle;
            record.OwnsProcessHandle = ownsProcessHandle;

            bool inJob;
            record.JobMembershipVerified =
                processHandle != IntPtr.Zero &&
                IsProcessInJob(processHandle, job, out inJob) &&
                inJob;

            FILETIME creation;
            FILETIME exit;
            FILETIME kernel;
            FILETIME user;
            if (processHandle != IntPtr.Zero &&
                GetProcessTimes(processHandle, out creation, out exit, out kernel, out user))
            {
                record.CreationFileTimeUtc =
                    FileTimeValue(creation).ToString(CultureInfo.InvariantCulture);
            }
            else
            {
                record.CreationFileTimeUtc = "";
            }

            record.ParentPid = processHandle == IntPtr.Zero ? 0 : ParentProcessId(processHandle);
            if (processHandle != IntPtr.Zero)
            {
                StringBuilder path = new StringBuilder(32768);
                uint size = (uint)path.Capacity;
                record.ExecutablePath = QueryFullProcessImageName(processHandle, 0, path, ref size)
                    ? path.ToString()
                    : "";
            }
            else
            {
                record.ExecutablePath = "";
            }

            record.CommandLine = QueryCommandLine(pid);
            if (String.IsNullOrEmpty(record.CommandLine))
            {
                record.CommandLine = commandLineFallback ?? "";
            }
            record.IdentityComplete =
                record.JobMembershipVerified &&
                record.ParentPid > 0 &&
                !String.IsNullOrEmpty(record.CreationFileTimeUtc) &&
                !String.IsNullOrEmpty(record.ExecutablePath);
            record.ExitKind = "";
            return record;
        }

        private static ProcessRecord InspectCurrentProcess()
        {
            Process process = Process.GetCurrentProcess();
            FILETIME creation;
            FILETIME exit;
            FILETIME kernel;
            FILETIME user;
            string creationValue = "";
            if (GetProcessTimes(process.Handle, out creation, out exit, out kernel, out user))
            {
                creationValue = FileTimeValue(creation).ToString(CultureInfo.InvariantCulture);
            }
            return new ProcessRecord
            {
                Pid = (uint)process.Id,
                ParentPid = ParentProcessId(process.Handle),
                CreationFileTimeUtc = creationValue,
                ExecutablePath = process.MainModule == null ? "" : process.MainModule.FileName,
                CommandLine = Environment.CommandLine,
                IdentityComplete = !String.IsNullOrEmpty(creationValue),
                JobMembershipVerified = false,
                JobNewProcessObserved = false,
                FirstObservationSequence = -1,
                FirstObservedAt = IsoNow(),
                ExitObserved = false,
                ExitSequence = -1,
                ExitedAt = "",
                ExitKind = ""
            };
        }

        private static IntPtr CreateInheritedFile(string path, uint desiredAccess, uint disposition)
        {
            SECURITY_ATTRIBUTES attributes = new SECURITY_ATTRIBUTES
            {
                nLength = (uint)Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)),
                lpSecurityDescriptor = IntPtr.Zero,
                bInheritHandle = true
            };
            IntPtr handle = CreateFile(
                path,
                desiredAccess,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                ref attributes,
                disposition,
                FILE_ATTRIBUTE_NORMAL,
                IntPtr.Zero);
            if (handle == INVALID_HANDLE_VALUE)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "CREATE_STDIO_FILE_FAILED");
            }
            return handle;
        }

        private static void MarkExit(ProcessRecord record, int sequence, string exitKind)
        {
            record.ExitObserved = true;
            record.ExitSequence = sequence;
            record.ExitedAt = IsoNow();
            record.ExitKind = exitKind;
            uint exitCode;
            if (record.ProcessHandle != IntPtr.Zero &&
                GetExitCodeProcess(record.ProcessHandle, out exitCode) &&
                exitCode != STILL_ACTIVE)
            {
                record.ExitCode = unchecked((int)exitCode);
            }
        }

        private static string EscapeJson(string value)
        {
            StringBuilder builder = new StringBuilder(value.Length);
            foreach (char current in value)
            {
                switch (current)
                {
                    case '\\':
                        builder.Append("\\\\");
                        break;
                    case '"':
                        builder.Append("\\\"");
                        break;
                    case '\n':
                        builder.Append("\\n");
                        break;
                    case '\r':
                        builder.Append("\\r");
                        break;
                    case '\t':
                        builder.Append("\\t");
                        break;
                    default:
                        builder.Append(current);
                        break;
                }
            }
            return builder.ToString();
        }

        private static string Sha256File(string path)
        {
            using (System.Security.Cryptography.SHA256 sha =
                System.Security.Cryptography.SHA256.Create())
            using (FileStream stream = new FileStream(
                path,
                FileMode.Open,
                FileAccess.Read,
                FileShare.ReadWrite | FileShare.Delete))
            {
                byte[] hash = sha.ComputeHash(stream);
                StringBuilder builder = new StringBuilder(hash.Length * 2);
                foreach (byte value in hash)
                {
                    builder.Append(value.ToString("x2", CultureInfo.InvariantCulture));
                }
                return builder.ToString();
            }
        }

        // R6.1 early task-owned process identity. Published by the Job runner
        // after process creation and before waiting for job closeout, using a
        // no-overwrite atomic protocol (exclusive temp file + fsync + rename).
        // Binds task marker, session/generation, root PID, process creation
        // identity, executable identity, and a schema version.
        private static void PublishEarlyIdentity(
            string identityPath,
            JobRunResult result,
            ProcessRecord root,
            string session,
            int generation,
            string schemaVersion)
        {
            string tempPath = identityPath + ".tmp";
            if (File.Exists(identityPath) || File.Exists(tempPath))
            {
                throw new IOException("EARLY_IDENTITY_PATH_EXISTS");
            }
            string executableSha256 = "";
            string executableBasename = "";
            if (!String.IsNullOrEmpty(root.ExecutablePath))
            {
                try
                {
                    executableSha256 = Sha256File(root.ExecutablePath);
                }
                catch
                {
                    executableSha256 = "";
                }
                executableBasename = Path.GetFileName(root.ExecutablePath);
            }
            string json =
                "{\"schemaVersion\":\"" + EscapeJson(schemaVersion) + "\"" +
                ",\"taskMarker\":\"" + EscapeJson(result.TaskMarker) + "\"" +
                ",\"session\":\"" + EscapeJson(session) + "\"" +
                ",\"generation\":" + generation.ToString(CultureInfo.InvariantCulture) +
                ",\"rootPid\":" + root.Pid.ToString(CultureInfo.InvariantCulture) +
                ",\"rootCreationFileTimeUtc\":\"" + EscapeJson(root.CreationFileTimeUtc) + "\"" +
                ",\"executableBasename\":\"" + EscapeJson(executableBasename) + "\"" +
                ",\"executableSha256\":\"" + EscapeJson(executableSha256) + "\"}";
            using (FileStream stream = new FileStream(
                tempPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None))
            {
                byte[] bytes = Encoding.UTF8.GetBytes(json + Environment.NewLine);
                stream.Write(bytes, 0, bytes.Length);
                stream.Flush(true);
            }
            File.Move(tempPath, identityPath);
        }

        private static void CloseProcessHandles(IEnumerable<ProcessRecord> processes, IntPtr rootHandle)
        {
            foreach (ProcessRecord process in processes)
            {
                if (process.OwnsProcessHandle &&
                    process.ProcessHandle != IntPtr.Zero &&
                    process.ProcessHandle != rootHandle)
                {
                    CloseHandle(process.ProcessHandle);
                    process.ProcessHandle = IntPtr.Zero;
                }
            }
        }

        public static JobRunResult Run(
            string executable,
            string[] arguments,
            string workingDirectory,
            string stdoutPath,
            string stderrPath,
            string taskMarker,
            string identityPath,
            string session,
            int generation,
            int timeoutMilliseconds)
        {
            JobRunResult result = new JobRunResult
            {
                SchemaVersion = "uagent.mvp15d.windows-job-process-run.v1",
                TaskMarker = taskMarker,
                JobName = "Local\\UAgentMvp15D-" + taskMarker,
                Launcher = InspectCurrentProcess(),
                Processes = new List<ProcessRecord>(),
                FailureCode = ""
            };

            IntPtr job = IntPtr.Zero;
            IntPtr completionPort = IntPtr.Zero;
            IntPtr stdoutHandle = IntPtr.Zero;
            IntPtr stderrHandle = IntPtr.Zero;
            IntPtr stdinHandle = IntPtr.Zero;
            PROCESS_INFORMATION processInformation = new PROCESS_INFORMATION();
            Dictionary<uint, ProcessRecord> active = new Dictionary<uint, ProcessRecord>();
            int sequence = 0;
            bool rootAssignedToJob = false;

            try
            {
                job = CreateJobObject(IntPtr.Zero, result.JobName);
                if (job == IntPtr.Zero)
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "CREATE_JOB_FAILED");
                }
                if (Marshal.GetLastWin32Error() == ERROR_ALREADY_EXISTS)
                {
                    throw new InvalidOperationException("JOB_MARKER_COLLISION");
                }

                JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits =
                    new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
                limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                SetJobStruct(job, JobObjectExtendedLimitInformation, limits);

                completionPort = CreateIoCompletionPort(
                    INVALID_HANDLE_VALUE,
                    IntPtr.Zero,
                    UIntPtr.Zero,
                    1);
                if (completionPort == IntPtr.Zero)
                {
                    throw new Win32Exception(
                        Marshal.GetLastWin32Error(),
                        "CREATE_COMPLETION_PORT_FAILED");
                }
                JOBOBJECT_ASSOCIATE_COMPLETION_PORT association =
                    new JOBOBJECT_ASSOCIATE_COMPLETION_PORT
                    {
                        CompletionKey = new IntPtr(1),
                        CompletionPort = completionPort
                    };
                SetJobStruct(job, JobObjectAssociateCompletionPortInformation, association);

                stdoutHandle = CreateInheritedFile(stdoutPath, GENERIC_WRITE, CREATE_NEW);
                stderrHandle = CreateInheritedFile(stderrPath, GENERIC_WRITE, CREATE_NEW);
                stdinHandle = CreateInheritedFile("NUL", GENERIC_READ, OPEN_EXISTING);

                STARTUPINFO startup = new STARTUPINFO();
                startup.cb = (uint)Marshal.SizeOf(typeof(STARTUPINFO));
                startup.dwFlags = STARTF_USESTDHANDLES;
                startup.hStdInput = stdinHandle;
                startup.hStdOutput = stdoutHandle;
                startup.hStdError = stderrHandle;
                StringBuilder commandLine = new StringBuilder(BuildCommandLine(executable, arguments));
                if (!CreateProcess(
                    executable,
                    commandLine,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    true,
                    CREATE_SUSPENDED | CREATE_NO_WINDOW,
                    IntPtr.Zero,
                    workingDirectory,
                    ref startup,
                    out processInformation))
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "CREATE_PROCESS_FAILED");
                }

                result.RootPid = processInformation.dwProcessId;
                if (!AssignProcessToJobObject(job, processInformation.hProcess))
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "ASSIGN_PROCESS_TO_JOB_FAILED");
                }
                rootAssignedToJob = true;

                ProcessRecord root = InspectProcess(
                    processInformation.hProcess,
                    false,
                    processInformation.dwProcessId,
                    job,
                    commandLine.ToString(),
                    sequence++,
                    false);
                result.Processes.Add(root);
                active.Add(root.Pid, root);

                // R6.1: publish the early task-owned identity after process
                // creation and before waiting for job closeout, while the root
                // process is guaranteed alive (still suspended). A failed
                // publication marks the run failed but never prevents the Job
                // closeout from proving zero residual processes.
                try
                {
                    PublishEarlyIdentity(
                        identityPath,
                        result,
                        root,
                        session,
                        generation,
                        "uagent.mvp15d.windows-job-process-identity.v1");
                }
                catch (Exception identityError)
                {
                    result.FailureCode = String.IsNullOrEmpty(identityError.Message)
                        ? "WINDOWS_JOB_EARLY_IDENTITY_FAILED"
                        : identityError.Message.Split(':')[0];
                    result.UnexpectedJobMessageCount++;
                }

                if (ResumeThread(processInformation.hThread) == UInt32.MaxValue)
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "RESUME_PROCESS_FAILED");
                }
                CloseHandle(processInformation.hThread);
                processInformation.hThread = IntPtr.Zero;
                CloseHandle(stdoutHandle);
                stdoutHandle = IntPtr.Zero;
                CloseHandle(stderrHandle);
                stderrHandle = IntPtr.Zero;
                CloseHandle(stdinHandle);
                stdinHandle = IntPtr.Zero;

                Stopwatch elapsed = Stopwatch.StartNew();
                bool cleanupDeadlineStarted = false;
                Stopwatch cleanupElapsed = null;
                Stopwatch completionDrainElapsed = null;
                while (!result.ActiveProcessZeroObserved ||
                    completionDrainElapsed.ElapsedMilliseconds < 1000)
                {
                    if (!result.TimedOut &&
                        !result.ActiveProcessZeroObserved &&
                        elapsed.ElapsedMilliseconds >= timeoutMilliseconds)
                    {
                        result.TimedOut = true;
                        result.FailureCode = "WINDOWS_JOB_SESSION_TIMEOUT";
                        result.ResidualCountBeforeCleanup = ActiveProcessCount(job);
                        if (result.ResidualCountBeforeCleanup > 0)
                        {
                            if (!TerminateJobObject(job, 2))
                            {
                                result.FailureCode = "WINDOWS_JOB_TERMINATION_FAILED";
                            }
                            else
                            {
                                result.ForcedJobTermination = true;
                            }
                        }
                        cleanupDeadlineStarted = true;
                        cleanupElapsed = Stopwatch.StartNew();
                    }
                    if (cleanupDeadlineStarted && cleanupElapsed.ElapsedMilliseconds >= 30000)
                    {
                        break;
                    }

                    uint message;
                    UIntPtr completionKey;
                    IntPtr overlapped;
                    bool received = GetQueuedCompletionStatus(
                        completionPort,
                        out message,
                        out completionKey,
                        out overlapped,
                        250);
                    if (!received)
                    {
                        int error = Marshal.GetLastWin32Error();
                        if (error == WAIT_TIMEOUT)
                        {
                            continue;
                        }
                        throw new Win32Exception(error, "JOB_COMPLETION_PORT_FAILED");
                    }
                    if (completionDrainElapsed != null)
                    {
                        completionDrainElapsed.Restart();
                    }

                    uint pid = unchecked((uint)overlapped.ToInt64());
                    if (message == JOB_OBJECT_MSG_NEW_PROCESS)
                    {
                        ProcessRecord existing;
                        if (active.TryGetValue(pid, out existing))
                        {
                            existing.JobNewProcessObserved = true;
                            continue;
                        }
                        IntPtr processHandle = OpenProcess(
                            PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE,
                            false,
                            pid);
                        ProcessRecord observed = InspectProcess(
                            processHandle,
                            processHandle != IntPtr.Zero,
                            pid,
                            job,
                            "",
                            sequence++,
                            true);
                        result.Processes.Add(observed);
                        active[pid] = observed;
                    }
                    else if (
                        message == JOB_OBJECT_MSG_EXIT_PROCESS ||
                        message == JOB_OBJECT_MSG_ABNORMAL_EXIT_PROCESS)
                    {
                        ProcessRecord exiting;
                        if (active.TryGetValue(pid, out exiting))
                        {
                            MarkExit(
                                exiting,
                                sequence++,
                                message == JOB_OBJECT_MSG_EXIT_PROCESS ? "exit" : "abnormal_exit");
                            active.Remove(pid);
                        }
                        else
                        {
                            ProcessRecord missing = new ProcessRecord
                            {
                                Pid = pid,
                                IdentityComplete = false,
                                JobMembershipVerified = false,
                                JobNewProcessObserved = false,
                                FirstObservationSequence = sequence++,
                                FirstObservedAt = IsoNow(),
                                ExitObserved = true,
                                ExitSequence = sequence++,
                                ExitedAt = IsoNow(),
                                ExitKind = "exit_without_start"
                            };
                            result.Processes.Add(missing);
                        }
                    }
                    else if (message == JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO)
                    {
                        if (ActiveProcessCount(job) == 0)
                        {
                            result.ActiveProcessZeroObserved = true;
                            result.ActiveProcessZeroObservedAt = IsoNow();
                            completionDrainElapsed = Stopwatch.StartNew();
                        }
                        else
                        {
                            result.UnexpectedJobMessageCount++;
                        }
                    }
                    else
                    {
                        result.UnexpectedJobMessageCount++;
                    }
                }

                ProcessRecord rootRecord = result.Processes.Find(
                    delegate(ProcessRecord value) { return value.Pid == result.RootPid; });
                if (rootRecord != null)
                {
                    uint rootExit;
                    if (GetExitCodeProcess(processInformation.hProcess, out rootExit) &&
                        rootExit != STILL_ACTIVE)
                    {
                        result.RootExitCode = unchecked((int)rootExit);
                    }
                }
                result.FinalResidualCount = ActiveProcessCount(job);
                result.AccountingTotalProcessCount = TotalProcessCount(job);
                if (!result.ActiveProcessZeroObserved && String.IsNullOrEmpty(result.FailureCode))
                {
                    result.FailureCode = "WINDOWS_JOB_ACTIVE_ZERO_MISSING";
                }
                if (result.FinalResidualCount != 0 && String.IsNullOrEmpty(result.FailureCode))
                {
                    result.FailureCode = "WINDOWS_JOB_RESIDUAL_PROCESS";
                }
            }
            catch (Exception error)
            {
                result.FailureCode =
                    String.IsNullOrEmpty(error.Message)
                        ? "WINDOWS_JOB_RUNNER_FAILED"
                        : error.Message.Split(':')[0];
                if (processInformation.hProcess != IntPtr.Zero && !rootAssignedToJob)
                {
                    uint rootExit;
                    if (GetExitCodeProcess(processInformation.hProcess, out rootExit) &&
                        rootExit == STILL_ACTIVE)
                    {
                        result.ForcedUnassignedRootTermination =
                            TerminateProcess(processInformation.hProcess, 2);
                        if (result.ForcedUnassignedRootTermination)
                        {
                            WaitForSingleObject(processInformation.hProcess, 5000);
                        }
                        else
                        {
                            result.FailureCode =
                                "WINDOWS_JOB_UNASSIGNED_ROOT_TERMINATION_FAILED";
                        }
                        if (GetExitCodeProcess(processInformation.hProcess, out rootExit))
                        {
                            result.UnassignedRootResidualAfterCleanup =
                                rootExit == STILL_ACTIVE;
                        }
                        else
                        {
                            result.UnassignedRootResidualAfterCleanup = true;
                        }
                    }
                }
                if (job != IntPtr.Zero)
                {
                    try
                    {
                        result.ResidualCountBeforeCleanup = ActiveProcessCount(job);
                    }
                    catch
                    {
                        result.ResidualCountBeforeCleanup = UInt32.MaxValue;
                    }
                    if (result.ResidualCountBeforeCleanup > 0 &&
                        result.ResidualCountBeforeCleanup != UInt32.MaxValue)
                    {
                        result.ForcedJobTermination = TerminateJobObject(job, 2);
                    }
                }
            }
            finally
            {
                if (stdoutHandle != IntPtr.Zero && stdoutHandle != INVALID_HANDLE_VALUE)
                {
                    CloseHandle(stdoutHandle);
                }
                if (stderrHandle != IntPtr.Zero && stderrHandle != INVALID_HANDLE_VALUE)
                {
                    CloseHandle(stderrHandle);
                }
                if (stdinHandle != IntPtr.Zero && stdinHandle != INVALID_HANDLE_VALUE)
                {
                    CloseHandle(stdinHandle);
                }
                if (processInformation.hThread != IntPtr.Zero)
                {
                    CloseHandle(processInformation.hThread);
                }
                if (job != IntPtr.Zero)
                {
                    try
                    {
                        result.FinalResidualCount = ActiveProcessCount(job);
                        result.AccountingTotalProcessCount = TotalProcessCount(job);
                    }
                    catch
                    {
                        result.FinalResidualCount = UInt32.MaxValue;
                        result.AccountingTotalProcessCount = UInt32.MaxValue;
                    }
                }
                CloseProcessHandles(result.Processes, processInformation.hProcess);
                if (processInformation.hProcess != IntPtr.Zero)
                {
                    CloseHandle(processInformation.hProcess);
                }
                if (completionPort != IntPtr.Zero)
                {
                    CloseHandle(completionPort);
                }
                if (job != IntPtr.Zero)
                {
                    CloseHandle(job);
                }
            }
            return result;
        }
    }
}
'@

try {
    Add-Type -TypeDefinition $source -Language CSharp -ReferencedAssemblies System.Management
    $argumentJson = [Text.Encoding]::UTF8.GetString(
        [Convert]::FromBase64String($ArgumentsBase64)
    )
    [string[]]$arguments = @((ConvertFrom-Json $argumentJson))
    $result = [UAgent.Mvp15D.WindowsJobRunner]::Run(
        $Executable,
        $arguments,
        $WorkingDirectory,
        $StdoutPath,
        $StderrPath,
        $TaskMarker,
        $IdentityPath,
        $Session,
        $Generation,
        $TimeoutMilliseconds
    )
    [Console]::Out.WriteLine(($result | ConvertTo-Json -Depth 8 -Compress))
    if ($result.FailureCode) {
        exit 2
    }
} catch {
    [Console]::Error.WriteLine(
        (@{
            status = "failed"
            reason = "WINDOWS_JOB_HELPER_FAILED"
            errorType = $_.Exception.GetType().FullName
        } | ConvertTo-Json -Compress)
    )
    exit 2
}
