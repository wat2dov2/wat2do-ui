package io.wat2do;

import android.app.UiAutomation;
import android.graphics.Point;
import android.view.Display;
import android.view.accessibility.AccessibilityNodeInfo;
import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.util.concurrent.TimeoutException;

/**
 * Prints the active window's accessibility tree each time a line arrives on stdin.
 *
 * <p>It is `uiautomator dump` kept running: that command starts a new runtime and
 * connects to Android's accessibility service for every read, which takes seconds, while
 * this process connects once and reads in a fraction of that. It runs under app_process
 * with /system/framework/uiautomator.jar on its class path and calls the same classes
 * `uiautomator dump` does, so it prints the same XML for the same window: the active
 * one, never the keyboard or a window behind a dialog.
 *
 * <p>Arguments: how long in milliseconds the screen must go without a change before it
 * is read, the longest wait for that in milliseconds (a screen that never settles, such
 * as a playing video, is then read as it is), and the file the dump goes through.
 * A line with only the end marker follows every read, and the first one says it is ready.
 */
public final class ScreenReader {
    private static final String END = "<<wat2do-screen-end>>";

    private ScreenReader() {}

    // Display.getRealSize is what `uiautomator dump` itself uses for the screen size.
    @SuppressWarnings("deprecation")
    public static void main(String[] args) throws Exception {
        long quietMillis = Long.parseLong(args[0]);
        long waitMillis = Long.parseLong(args[1]);
        File dump = new File(args[2]);

        Class<?> shell = Class.forName("com.android.uiautomator.core.UiAutomationShellWrapper");
        Object wrapper = shell.getConstructor().newInstance();
        shell.getMethod("connect").invoke(wrapper);
        try {
            // Like `uiautomator dump` without --compressed: unimportant views are read too.
            shell.getMethod("setCompressedLayoutHierarchy", boolean.class).invoke(wrapper, false);
            UiAutomation automation =
                    (UiAutomation) shell.getMethod("getUiAutomation").invoke(wrapper);
            Method dumpWindow =
                    Class.forName("com.android.uiautomator.core.AccessibilityNodeInfoDumper")
                            .getMethod(
                                    "dumpWindowToFile",
                                    AccessibilityNodeInfo.class,
                                    File.class,
                                    int.class,
                                    int.class,
                                    int.class);
            Object displays =
                    Class.forName("android.hardware.display.DisplayManagerGlobal")
                            .getMethod("getInstance")
                            .invoke(null);
            Method realDisplay = displays.getClass().getMethod("getRealDisplay", int.class);

            PrintStream out = System.out;
            BufferedReader requests = new BufferedReader(new InputStreamReader(System.in));
            out.println(END);
            out.flush();
            while (requests.readLine() != null) {
                try {
                    automation.waitForIdle(quietMillis, waitMillis);
                } catch (TimeoutException ignored) {
                    // The screen kept changing; it is read as it is now.
                }
                AccessibilityNodeInfo root = automation.getRootInActiveWindow();
                if (root != null) {
                    Display display =
                            (Display) realDisplay.invoke(displays, Display.DEFAULT_DISPLAY);
                    Point size = new Point();
                    display.getRealSize(size);
                    dump.delete();
                    dumpWindow.invoke(null, root, dump, display.getRotation(), size.x, size.y);
                    if (dump.exists()) {
                        out.write(Files.readAllBytes(dump.toPath()));
                        out.println();
                    }
                }
                out.println(END);
                out.flush();
            }
        } finally {
            shell.getMethod("disconnect").invoke(wrapper);
        }
    }
}
