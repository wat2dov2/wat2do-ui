ObjC.import("AppKit");
function run(argv) {
    if (argv.length) {
        const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(Number(argv[0]));
        return String(!app.isNil() && app.activateWithOptions(2));
    }
    return String($.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier);
}