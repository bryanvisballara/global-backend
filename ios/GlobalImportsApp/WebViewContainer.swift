import SwiftUI
import UIKit
import UniformTypeIdentifiers
import WebKit

@MainActor
final class WebViewStore: NSObject, ObservableObject, WKScriptMessageHandler {
    let webView: WKWebView
    @Published private(set) var isLoading = true
    @Published private(set) var loadError: String?
    private var pushTokenObserver: NSObjectProtocol?
    private var latestPushToken = ""
    private var loadingTimeoutTask: DispatchWorkItem?
    private var activeDownloadTask: URLSessionDownloadTask?
    private var downloadedFileURL: URL?

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.scrollView.contentInsetAdjustmentBehavior = .never

        super.init()

        webView.configuration.userContentController.add(self, name: "globalImportsDownload")
        webView.configuration.userContentController.add(self, name: "globalImportsBadge")
        webView.configuration.userContentController.add(self, name: "globalImportsExternalLink")
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black

        pushTokenObserver = NotificationCenter.default.addObserver(
            forName: .globalImportsPushTokenDidChange,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let token = notification.object as? String else { return }

            Task { @MainActor [weak self] in
                self?.latestPushToken = token
                self?.injectPushTokenIfNeeded()
            }
        }
    }

    deinit {
        if let pushTokenObserver {
            NotificationCenter.default.removeObserver(pushTokenObserver)
        }

        webView.configuration.userContentController.removeScriptMessageHandler(forName: "globalImportsDownload")
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "globalImportsBadge")
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "globalImportsExternalLink")
    }

    func load(_ url: URL, forceReload: Bool = false) {
        if !forceReload, webView.url == url {
            return
        }

        loadError = nil
        startLoadingTimeoutWatchdog()
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
    }

    func reload() {
        loadError = nil
        startLoadingTimeoutWatchdog()
        webView.reload()
    }

    private func startLoadingTimeoutWatchdog() {
        loadingTimeoutTask?.cancel()

        let timeoutTask = DispatchWorkItem { [weak self] in
            guard let self else { return }
            guard self.isLoading else { return }
            self.isLoading = false
            self.loadError = "Tiempo de espera agotado. Verifica tu conexión o la URL configurada."
        }

        loadingTimeoutTask = timeoutTask
        DispatchQueue.main.asyncAfter(deadline: .now() + 18, execute: timeoutTask)
    }

    private func finishLoading(withError errorMessage: String? = nil) {
        loadingTimeoutTask?.cancel()
        loadingTimeoutTask = nil
        isLoading = false
        loadError = errorMessage
    }

    private func injectPushTokenIfNeeded() {
        guard !latestPushToken.isEmpty else { return }

        let escapedToken = latestPushToken.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        let script = """
        window.__globalImportsNativePush = {
          token: \"\(escapedToken)\",
          platform: \"ios\",
          provider: \"apns\",
          appVersion: \"1.0\"
        };
        window.dispatchEvent(new CustomEvent('globalimports:push-token', { detail: window.__globalImportsNativePush }));
        """

        webView.evaluateJavaScript(script)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "globalImportsBadge" {
            let body = message.body as? [String: Any]
            let count = (body?["count"] as? NSNumber)?.intValue ?? 0
            setBadgeCount(count)
            return
        }

        if message.name == "globalImportsExternalLink" {
            let body = message.body as? [String: Any]
            let rawURL = body?["url"] as? String ?? ""
            openExternalLink(rawURL: rawURL)
            return
        }

        guard message.name == "globalImportsDownload" else { return }
        guard let body = message.body as? [String: Any] else { return }
        guard let rawURL = body["url"] as? String, !rawURL.isEmpty else { return }

        let preferredFileName = body["fileName"] as? String
        startNativeDownload(rawURL: rawURL, preferredFileName: preferredFileName)
    }

    private func setBadgeCount(_ count: Int) {
        UIApplication.shared.applicationIconBadgeNumber = max(0, count)
    }

    private func openExternalLink(rawURL: String) {
        guard let resolvedURL = URL(string: rawURL, relativeTo: webView.url)?.absoluteURL else {
            return
        }

        UIApplication.shared.open(resolvedURL, options: [:], completionHandler: nil)
    }

    private func startNativeDownload(rawURL: String, preferredFileName: String?) {
        guard let resolvedURL = URL(string: rawURL, relativeTo: webView.url)?.absoluteURL else {
            presentDownloadError(message: "No pudimos preparar la descarga.")
            return
        }

        activeDownloadTask?.cancel()

        let request = URLRequest(url: resolvedURL, cachePolicy: .reloadIgnoringLocalCacheData)
        let task = URLSession.shared.downloadTask(with: request) { [weak self] temporaryURL, response, error in
            let persistedFileResult: Result<URL, Error>? = {
                guard let temporaryURL else { return nil }

                do {
                    let persistedURL = try Self.persistDownloadedFile(
                        from: temporaryURL,
                        sourceURL: resolvedURL,
                        response: response,
                        preferredFileName: preferredFileName
                    )
                    return .success(persistedURL)
                } catch {
                    return .failure(error)
                }
            }()

            Task { @MainActor [weak self] in
                self?.finishNativeDownload(
                    sourceURL: resolvedURL,
                    persistedFileResult: persistedFileResult,
                    error: error
                )
            }
        }

        activeDownloadTask = task
        task.resume()
    }

    private func finishNativeDownload(
        sourceURL: URL,
        persistedFileResult: Result<URL, Error>?,
        error: Error?
    ) {
        activeDownloadTask = nil

        if let error, (error as NSError).code != NSURLErrorCancelled {
            presentDownloadError(message: error.localizedDescription)
            return
        }

        guard let persistedFileResult else {
            presentDownloadError(message: "La descarga no devolvió un archivo válido.")
            return
        }

        do {
            let destinationURL = try persistedFileResult.get()
            downloadedFileURL = destinationURL
            presentShareSheet(for: destinationURL)
        } catch {
            presentDownloadError(message: error.localizedDescription)
        }
    }

    nonisolated private static func persistDownloadedFile(
        from temporaryURL: URL,
        sourceURL: URL,
        response: URLResponse?,
        preferredFileName: String?
    ) throws -> URL {
        let fileManager = FileManager.default
        let tempDirectory = fileManager.temporaryDirectory.appendingPathComponent("GlobalImportsDownloads", isDirectory: true)

        try fileManager.createDirectory(at: tempDirectory, withIntermediateDirectories: true)

        let resolvedFileName = resolvedDownloadFileName(
            sourceURL: sourceURL,
            response: response,
            preferredFileName: preferredFileName
        )
        let destinationURL = tempDirectory.appendingPathComponent(resolvedFileName)

        if fileManager.fileExists(atPath: destinationURL.path) {
            try fileManager.removeItem(at: destinationURL)
        }

        do {
            try fileManager.moveItem(at: temporaryURL, to: destinationURL)
        } catch {
            try fileManager.copyItem(at: temporaryURL, to: destinationURL)
        }

        return destinationURL
    }

    nonisolated private static func resolvedDownloadFileName(
        sourceURL: URL,
        response: URLResponse?,
        preferredFileName: String?
    ) -> String {
        let trimmedPreferredName = preferredFileName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let suggestedName = response?.suggestedFilename?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let sourceName = sourceURL.lastPathComponent.trimmingCharacters(in: .whitespacesAndNewlines)

        var baseName = !trimmedPreferredName.isEmpty ? trimmedPreferredName : (!suggestedName.isEmpty ? suggestedName : sourceName)

        if baseName.isEmpty {
            baseName = "archivo"
        }

        let currentExtension = URL(fileURLWithPath: baseName).pathExtension
        if currentExtension.isEmpty {
            if !URL(fileURLWithPath: suggestedName).pathExtension.isEmpty {
                baseName += ".\(URL(fileURLWithPath: suggestedName).pathExtension)"
            } else if !sourceURL.pathExtension.isEmpty {
                baseName += ".\(sourceURL.pathExtension)"
            } else if let mimeType = response?.mimeType,
                      let fileType = UTType(mimeType: mimeType),
                      let preferredExtension = fileType.preferredFilenameExtension {
                baseName += ".\(preferredExtension)"
            }
        }

        return sanitizeFileName(baseName)
    }

    nonisolated private static func sanitizeFileName(_ fileName: String) -> String {
        let invalidCharacters = CharacterSet(charactersIn: "/\\:?%*|\"<>")
        let cleaned = fileName.components(separatedBy: invalidCharacters).joined(separator: "-")
        return cleaned.isEmpty ? "archivo" : cleaned
    }

    private func presentShareSheet(for fileURL: URL) {
        guard let presenter = topViewController() else {
            presentDownloadError(message: "No encontramos una vista para compartir el archivo.")
            return
        }

        let activityController = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)

        if let popover = activityController.popoverPresentationController {
            popover.sourceView = webView
            popover.sourceRect = CGRect(
                x: webView.bounds.midX,
                y: webView.bounds.midY,
                width: 1,
                height: 1
            )
        }

        presenter.present(activityController, animated: true)
    }

    private func presentDownloadError(message: String) {
        guard let presenter = topViewController() else { return }

        let alert = UIAlertController(title: "Descarga no disponible", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cerrar", style: .default))
        presenter.present(alert, animated: true)
    }

    private func topViewController(base: UIViewController? = nil) -> UIViewController? {
        let startingController: UIViewController?

        if let base {
            startingController = base
        } else {
            startingController = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap { $0.windows }
                .first(where: \ .isKeyWindow)?
                .rootViewController
        }

        if let navigationController = startingController as? UINavigationController {
            return topViewController(base: navigationController.visibleViewController)
        }

        if let tabBarController = startingController as? UITabBarController {
            return topViewController(base: tabBarController.selectedViewController)
        }

        if let presentedController = startingController?.presentedViewController {
            return topViewController(base: presentedController)
        }

        return startingController
    }
}

extension WebViewStore: WKNavigationDelegate, WKUIDelegate {}

extension WebViewStore {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }

        let scheme = url.scheme?.lowercased() ?? ""
        let host = url.host?.lowercased() ?? ""
        let shouldOpenOutsideWebView = navigationAction.navigationType == .linkActivated && (
            navigationAction.targetFrame == nil
            || scheme == "whatsapp"
            || scheme == "mailto"
            || scheme == "tel"
            || host == "wa.me"
            || host == "api.whatsapp.com"
        )

        if shouldOpenOutsideWebView {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
            decisionHandler(.cancel)
            return
        }

        decisionHandler(.allow)
    }

    func resetWebsiteData(completion: (() -> Void)? = nil) {
        let dataStore = webView.configuration.websiteDataStore
        let dataTypes = WKWebsiteDataStore.allWebsiteDataTypes()

        dataStore.removeData(ofTypes: dataTypes, modifiedSince: .distantPast) {
            completion?()
        }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        isLoading = true
        loadError = nil
        startLoadingTimeoutWatchdog()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        finishLoading()
        injectPushTokenIfNeeded()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        finishLoading(withError: error.localizedDescription)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        finishLoading(withError: error.localizedDescription)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
        }

        return nil
    }
}

struct WebViewContainer: UIViewRepresentable {
    @ObservedObject var store: WebViewStore

    func makeUIView(context: Context) -> WKWebView {
        store.webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
