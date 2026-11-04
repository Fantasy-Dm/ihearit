using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using System.Reflection;

[assembly: AssemblyTitle("听个响 · I Hear It")]
[assembly: AssemblyProduct("I Hear It")]
[assembly: AssemblyDescription("你继续，俺在听")]

internal static class Launcher {
    private static readonly object LogLock = new object();
    private static string LogFile;
    private static void Log(string text) {
        if (text == null || LogFile == null) return;
        try { lock (LogLock) File.AppendAllText(LogFile, DateTime.Now.ToString("HH:mm:ss ") + Regex.Replace(text, @"/#[a-f0-9]{32,}", "/#[hidden]") + Environment.NewLine, new UTF8Encoding(false)); } catch { }
    }
    [STAThread]
    private static void Main(string[] args) {
        bool silent = Array.IndexOf(args, "--silent-errors") >= 0;
        try {
            string folder = AppDomain.CurrentDomain.BaseDirectory;
            string data = Environment.GetEnvironmentVariable("NOISE_DATA");
            if (String.IsNullOrEmpty(data)) data = Path.Combine(folder, "data");
            Directory.CreateDirectory(data);
            LogFile = Path.Combine(data, "startup.log");
            if (File.Exists(LogFile) && new FileInfo(LogFile).Length > 1048576) File.Delete(LogFile);
            Log("Starting I Hear It");
            string node = Path.Combine(folder, "runtime", "node.exe");
            if (!File.Exists(node)) node = "node.exe";
            ProcessStartInfo start = new ProcessStartInfo(node, "\"" + Path.Combine(folder, "server.js") + "\"");
            if (Array.IndexOf(args, "--no-open") >= 0) start.Arguments += " --no-open";
            start.WorkingDirectory = folder;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.WindowStyle = ProcessWindowStyle.Hidden;
            start.RedirectStandardOutput = true;
            start.RedirectStandardError = true;
            start.StandardOutputEncoding = Encoding.UTF8;
            start.StandardErrorEncoding = Encoding.UTF8;
            using (Process backend = new Process()) {
                backend.StartInfo = start;
                backend.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { Log(e.Data); };
                backend.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { Log(e.Data); };
                backend.Start();
                backend.BeginOutputReadLine();
                backend.BeginErrorReadLine();
                backend.WaitForExit();
                Log("Backend exit code: " + backend.ExitCode);
                Environment.ExitCode = backend.ExitCode;
                if (backend.ExitCode != 0 && !silent) MessageBox.Show("助手启动或运行失败。详情已保存到：\n" + LogFile, "听个响 · I Hear It", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        } catch (Exception error) {
            Log(error.ToString());
            if (!silent) MessageBox.Show("无法启动听个响：" + error.Message + (LogFile == null ? "" : "\n日志：" + LogFile), "听个响 · I Hear It", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Environment.ExitCode = 1;
        }
    }
}
