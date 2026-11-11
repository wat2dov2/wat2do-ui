package io.wat2do;

import android.app.Notification;
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
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Prints an app's notifications from every Android user, one JSON object per line.
 *
 * <p>It registers with Android's notification service the way the system's own listeners do
 * ({@code NotificationListenerService.registerAsSystemService}, hidden from apps), for every
 * user at once. That needs root, so it runs as root under app_process, and nothing has to be
 * installed or granted on the device. It only listens: it never dismisses, answers or opens a
 * notification.
 *
 * <p>Its one argument is the app's package. A line holds the Android user, the notification's
 * key, when it was posted, its channel and category, whether it is a group summary, and the
 * extras JSON can carry (text, lists of text, flags, numbers and nulls); pictures, icons and the
 * app's details are left out. The Mac decides what of it to keep, and keeps no direct
 * message's text.
 *
 * <p>The first line is the ready marker, printed once the service has connected the listener.
 * The notifications still showing come next, then each new one as it is posted. The reader
 * exits when its standard input closes, and when Android's notification service dies, since
 * its registration dies with it.
 */
public final class NotificationReader extends NotificationListenerService {
    private static final String READY = "<<wat2do-notifications-ready>>";
    private static final String SHELL = "com.android.shell";
    // UserHandle.USER_ALL: every Android user's notifications.
    private static final int EVERY_USER = -1;

    private final String app;

    private NotificationReader(String app) {
        this.app = app;
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
        NotificationReader reader = new NotificationReader(args[0]);
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

    // getUserId is the user's number without UserHandle's hidden getIdentifier.
    @SuppressWarnings("deprecation")
    private void print(StatusBarNotification posted) {
        if (!app.equals(posted.getPackageName())) {
            return;
        }
        try {
            Notification notification = posted.getNotification();
            JSONObject line = new JSONObject();
            line.put("user", posted.getUserId());
            line.put("key", posted.getKey());
            line.put("posted_at", posted.getPostTime());
            line.put("channel", orNull(notification.getChannelId()));
            line.put("category", orNull(notification.category));
            line.put(
                    "group_summary", (notification.flags & Notification.FLAG_GROUP_SUMMARY) != 0);
            line.put("extras", extras(notification.extras));
            System.out.println(line);
        } catch (RuntimeException | JSONException failure) {
            // Only the kind of failure: a message could quote the notification.
            System.err.println("A notification could not be read: " + failure.getClass().getName());
        }
    }

    // Bundle.get is the one way to read a value whose type is not known beforehand.
    @SuppressWarnings("deprecation")
    private static JSONObject extras(Bundle extras) {
        JSONObject carried = new JSONObject();
        if (extras == null) {
            return carried;
        }
        for (String key : extras.keySet()) {
            try {
                Object value = extras.get(key);
                if (value == null) {
                    carried.put(key, JSONObject.NULL);
                } else if (value instanceof CharSequence) {
                    carried.put(key, value.toString());
                } else if (value instanceof CharSequence[]) {
                    JSONArray texts = new JSONArray();
                    for (CharSequence text : (CharSequence[]) value) {
                        texts.put(text == null ? JSONObject.NULL : text.toString());
                    }
                    carried.put(key, texts);
                } else if (value instanceof Boolean || value instanceof Number) {
                    carried.put(key, value);
                }
            } catch (RuntimeException | JSONException ignored) {
                // A value JSON cannot carry, or one only the app can read, is left out.
            }
        }
        return carried;
    }

    private static Object orNull(String value) {
        return value == null ? JSONObject.NULL : value;
    }
}
