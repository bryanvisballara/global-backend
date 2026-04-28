import UIKit
import UserNotifications

extension Notification.Name {
    static let globalImportsPushTokenDidChange = Notification.Name("globalImportsPushTokenDidChange")
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        NSLog("[push][ios] App did finish launching")
        requestPushAuthorization(application: application)
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        NSLog("[push][ios] APNs token registered: %@", token)
        NotificationCenter.default.post(name: .globalImportsPushTokenDidChange, object: token)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NSLog("[push][ios] APNs registration failed: %@", error.localizedDescription)
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .badge])
    }

    private func requestPushAuthorization(application: UIApplication) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
            NSLog("[push][ios] Notification authorization granted=%@", granted ? "true" : "false")
            guard granted else { return }

            DispatchQueue.main.async {
                NSLog("[push][ios] Registering for remote notifications")
                application.registerForRemoteNotifications()
            }
        }
    }
}