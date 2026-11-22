import AppKit
import Darwin

let candidate = URL(fileURLWithPath: CommandLine.arguments[1])
let destination = URL(fileURLWithPath: CommandLine.arguments[2])
let files = FileManager.default
let identifier = "local.easyproto.desktop"

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

if (try? files.destinationOfSymbolicLink(atPath: destination.path)) != nil {
    fail("The installation path is a symbolic link. Move it before installing Easy Proto.")
}
if files.fileExists(atPath: destination.path) {
    guard Bundle(url: destination)?.bundleIdentifier == identifier else {
        fail("A different app already occupies the installation path.")
    }
    let running = NSRunningApplication.runningApplications(withBundleIdentifier: identifier)
        .filter { $0.bundleURL?.standardizedFileURL.path == destination.standardizedFileURL.path }
    for app in running where !app.isTerminated {
        guard app.terminate() else { fail("Quit the installed Easy Proto app and try again.") }
    }
    let deadline = Date().addingTimeInterval(15)
    while running.contains(where: { !$0.isTerminated }) && Date() < deadline {
        RunLoop.current.run(until: Date().addingTimeInterval(0.1))
    }
    guard running.allSatisfy({ $0.isTerminated }) else {
        fail("The installed Easy Proto app is still open. Quit it and try again.")
    }
    // Both bundles are on the Applications volume. Swap them in one operation.
    guard renamex_np(candidate.path, destination.path, UInt32(RENAME_SWAP)) == 0 else {
        fail("Could not replace Easy Proto: " + String(cString: strerror(errno)))
    }
} else {
    try files.moveItem(at: candidate, to: destination)
}
