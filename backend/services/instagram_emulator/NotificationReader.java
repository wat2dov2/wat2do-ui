package io.wat2do;

import android.content.ComponentName;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.pm.ApplicationInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Looper;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import java.io.IOException;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Prints an app's notifications from every Android user, one JSON object per line.
 *
 * <p>It registers with Android's notification service the way the system's own listeners do
 * ({@code NotificationListenerService.registerAsSystemService}, hidden from apps), for every
 * user at once. That needs root, so it runs as root under app_process, and nothing has to be
 * installed or granted on the device.
 *
 * <p>Arguments: the app's package, then the push categories to print. Only a notification from
 * that app whose push category is one of them is printed, so a direct message, and its text,
 * never leaves the device. A line holds the notification's extras that JSON can carry (text,
 * flags and numbers, and nulls), the way the phones' Automate flow forwarded them; pictures,
 * icons and the app's details are left out.
 *
 * <p>The first line is the ready marker, printed once the service has connected the listener.
 * The notifications still showing come next, then each new one as it is posted. The reader
 * exits when its standard input closes, and when Android's notification service dies, since
 * its registration dies with it.
 */
public final class NotificationReader extends NotificationListenerService {
    private static final String READY = "<<wat2do-notifications-ready>>";
    private static final String PUSH_CATEGORY = "com.instagram.android.igns.logging.push_category";
    private static final String SHELL = "com.android.shell";
    // UserHandle.USER_ALL: every Android user's notifications.
    private static final int EVERY_USER = -1;

    private final String app;
    private final Set<String> categories;

    private NotificationReader(String app, Set<String> categories) {
        this.app = app;
        this.categories = categories;
    }

    /** What a listener registered as a system service asks of its context. */
    private static final class ReaderContext extends ContextWrapper {
        private final ApplicationInfo info = new ApplicationInfo();

        ReaderContext() {
            super(null);
            info.packageName = SHELL;
            // Notifications reach a listener targeting this Android version unconverted.
            info.targetSdkVersion = Build.VERSION.SDK_INT;
        }

        @Override
        public Looper getMainLooper() {
            return Looper.getMainLooper();
        }

        @Override
        public ApplicationInfo getApplicationInfo() {
            return info;
        }

        @Override
        public String getPackageName() {
            return SHELL;
        }

        @Override
        public String getOpPackageName() {
            return SHELL;
        }

        @Override
        public Context getApplicationContext() {
            return this;
        }
    }

    // app_process starts no main looper, and the listener's callbacks run on that one.
    @SuppressWarnings("deprecation")
    public static void main(String[] args) throws Exception {
        Looper.prepareMainLooper();
        NotificationReader reader =
                new NotificationReader(
                        args[0], new HashSet<>(Arrays.asList(args).subList(1, args.length)));
        exitWhenInputCloses();
        IBinder service =
                (IBinder)
                        Class.forName("android.os.ServiceManager")
                                .getMethod("getService", String.class)
                                .invoke(null, Context.NOTIFICATION_SERVICE);
        service.linkToDeath(() -> System.exit(1), 0);
        NotificationListenerService.class
                .getMethod(
                        "registerAsSystemService",
                        Context.class,
                        ComponentName.class,
                        int.class)
                .invoke(
                        reader,
                        new ReaderContext(),
                        new ComponentName(SHELL, NotificationReader.class.getName()),
                        EVERY_USER);
        Looper.loop();
    }

    private static void exitWhenInputCloses() {
        Thread watcher =
                new Thread(
                        () -> {
                            try {
                                while (System.in.read() != -1) {
                                    // Nothing is ever sent; only the end of the input matters.
                                }
                            } catch (IOException ignored) {
                                // A broken input ends the reader too.
                            }
                            System.exit(0);
                        },
                        "input");
        watcher.setDaemon(true);
        watcher.start();
    }

    @Override
    public void onListenerConnected() {
        System.out.println(READY);
        StatusBarNotification[] showing = getActiveNotifications();
        if (showing != null) {
            for (StatusBarNotification notification : showing) {
                print(notification);
            }
        }
        System.out.flush();
    }

    @Override
    public void onNotificationPosted(StatusBarNotification notification) {
        print(notification);
        System.out.flush();
    }

    // Bundle.get is the one way to read a value whose type is not known beforehand.
    @SuppressWarnings("deprecation")
    private void print(StatusBarNotification notification) {
        if (!app.equals(notification.getPackageName())) {
            return;
        }
        try {
            Bundle extras = notification.getNotification().extras;
            if (extras == null || !categories.contains(extras.getString(PUSH_CATEGORY))) {
                return;
            }
            JSONObject line = new JSONObject();
            for (String key : extras.keySet()) {
                try {
                    Object value = extras.get(key);
                    if (value == null) {
                        line.put(key, JSONObject.NULL);
                    } else if (value instanceof CharSequence) {
                        line.put(key, value.toString());
                    } else if (value instanceof Boolean || value instanceof Number) {
                        line.put(key, value);
                    }
                } catch (RuntimeException | JSONException ignored) {
                    // A value JSON cannot carry, or one only the app can read, is left out.
                }
            }
            System.out.println(line);
        } catch (RuntimeException failure) {
            // Only the kind of failure: a message could quote the notification.
            System.err.println("A notification could not be read: " + failure.getClass().getName());
        }
    }
}
