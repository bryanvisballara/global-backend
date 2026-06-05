import UIKit
import UserNotifications

extension Notification.Name {
    static let globalImportsPushTokenDidChange = Notification.Name("globalImportsPushTokenDidChange")
    static let globalImportsPushNavigationRequested = Notification.Name("globalImportsPushNavigationRequested")
}

final class PushNavigationCenter {
    static let shared = PushNavigationCenter()

    private var pendingPayload: [String: String]?

    private init() {}

    func route(userInfo: [AnyHashable: Any]) {
        guard let payload = trackingPayload(from: userInfo) else {
            return
        }

        pendingPayload = payload
        NotificationCenter.default.post(name: .globalImportsPushNavigationRequested, object: payload)
    }

    func consumePendingPayload() -> [String: String]? {
        let payload = pendingPayload
        pendingPayload = nil
        return payload
    }

    private func trackingPayload(from userInfo: [AnyHashable: Any]) -> [String: String]? {
        let dataPayload = userInfo["data"] as? [String: Any]
            ?? (userInfo["data"] as? [AnyHashable: Any])?.reduce(into: [String: Any]()) { result, item in
                result[String(describing: item.key)] = item.value
            }

        func payloadValue(_ key: String) -> String {
            if let value = dataPayload?[key] {
                return String(describing: value).trimmingCharacters(in: .whitespacesAndNewlines)
            }

            if let value = userInfo[key] {
                return String(describing: value).trimmingCharacters(in: .whitespacesAndNewlines)
            }

            return ""
        }

        let type = payloadValue("type")
        let trackingNumber = payloadValue("trackingNumber")

        guard type == "tracking", !trackingNumber.isEmpty else {
            return nil
        }

        return [
            "type": type,
            "trackingNumber": trackingNumber,
            "orderId": payloadValue("orderId"),
            "stepKey": payloadValue("stepKey"),
        ]
    }
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

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        NSLog("[push][ios] Notification tapped with userInfo: %@", String(describing: userInfo))
        PushNavigationCenter.shared.route(userInfo: userInfo)
        completionHandler()
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