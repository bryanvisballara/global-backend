import SwiftUI

private let webShellVersion = "20260407-43"
private let productionWebAppURL = "https://global-backend-bdbx.onrender.com/app/index.html?v=\(webShellVersion)"
private let simulatorWebAppURL = "http://localhost:10000/app/index.html?v=\(webShellVersion)"
private let deviceLocalWebAppURL = "http://192.168.1.95:10000/app/index.html?v=\(webShellVersion)"

struct ContentView: View {
    @AppStorage("webAppURL_v4") private var webAppURL = deviceLocalWebAppURL
    @AppStorage("webShellVersion") private var storedWebShellVersion = ""
    @State private var draftURL = ""
    @State private var showSettings = false
    @StateObject private var webViewStore = WebViewStore()

    private var resolvedURL: URL? {
        URL(string: webAppURL)
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            WebViewContainer(store: webViewStore)
                .ignoresSafeArea()

            if webViewStore.isLoading {
                SplashOverlay()
                    .transition(.opacity)
            }

            if let loadError = webViewStore.loadError, !webViewStore.isLoading {
                ConnectionErrorOverlay(
                    message: loadError,
                    onRetry: {
                        loadCurrentURL(forceReload: true)
                    },
                    onOpenSettings: {
                        draftURL = webAppURL
                        showSettings = true
                    }
                )
                .transition(.opacity)
            }

            VStack {
                Spacer()

                HStack {
                    Spacer()

                    Color.clear
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                        .onLongPressGesture(minimumDuration: 1.1) {
                            draftURL = webAppURL
                            showSettings = true
                        }
                }
                .padding(.trailing, 10)
                .padding(.bottom, 10)
            }
        }
        .onAppear {
            prepareWebShell()
        }
        .onChange(of: webAppURL) {
            loadCurrentURL()
        }
        .animation(.easeOut(duration: 0.24), value: webViewStore.isLoading)
        .sheet(isPresented: $showSettings) {
            NavigationStack {
                Form {
                    Section("URL de la app") {
                        TextField("https://... o http://IP:10000/app/", text: $draftURL)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()

                        Button("Usar dominio produccion (recomendado)") {
                            draftURL = productionWebAppURL
                        }

                        Button("Usar localhost del simulador") {
                            draftURL = simulatorWebAppURL
                        }

                        Button("Usar IP local del Mac / iPhone") {
                            draftURL = deviceLocalWebAppURL
                        }

                    }

                    Section("Acceso oculto") {
                        Text("Mantén presionada la esquina inferior derecha para abrir esta configuración.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                .navigationTitle("Conexion")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cerrar") {
                            showSettings = false
                        }
                    }

                    ToolbarItem(placement: .confirmationAction) {
                        Button("Guardar") {
                            webAppURL = draftURL.trimmingCharacters(in: .whitespacesAndNewlines)
                            showSettings = false
                        }
                    }
                }
            }
            .presentationDetents([.medium])
        }
    }

    private func loadCurrentURL() {
        loadCurrentURL(forceReload: false)
    }

    private func prepareWebShell() {
        let hasNewShellVersion = storedWebShellVersion == webShellVersion

        if !hasNewShellVersion {
            storedWebShellVersion = webShellVersion
            webAppURL = defaultWebAppURL()

            webViewStore.resetWebsiteData {
                loadCurrentURL(forceReload: true)
            }
            return
        }

        let normalizedURL = normalizedWebAppURL(webAppURL)
        if normalizedURL != webAppURL {
            webAppURL = normalizedURL
            return
        }

        loadCurrentURL(forceReload: true)
    }

    private func defaultWebAppURL() -> String {
        #if targetEnvironment(simulator)
        simulatorWebAppURL
        #else
        deviceLocalWebAppURL
        #endif
    }

    private func normalizedWebAppURL(_ candidate: String) -> String {
        guard var components = URLComponents(string: candidate) else {
            return defaultWebAppURL()
        }

        #if targetEnvironment(simulator)
        if components.host == "192.168.1.95" {
            components.host = "localhost"
            return components.string ?? simulatorWebAppURL
        }
        return candidate
        #else
        if components.host == "localhost" || components.host == "127.0.0.1" || components.host == "::1" {
            components.host = "192.168.1.95"
            return components.string ?? deviceLocalWebAppURL
        }
        return candidate
        #endif
    }

    private func loadCurrentURL(forceReload: Bool) {
        guard let resolvedURL else { return }
        webViewStore.load(resolvedURL, forceReload: forceReload)
    }
}

private struct ConnectionErrorOverlay: View {
    let message: String
    let onRetry: () -> Void
    let onOpenSettings: () -> Void

    var body: some View {
        VStack {
            Spacer()

            VStack(spacing: 14) {
                Text("No pudimos abrir la app web")
                    .font(.headline)
                    .foregroundStyle(.white)

                Text(message)
                    .font(.footnote)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.white.opacity(0.74))

                HStack(spacing: 10) {
                    Button("Reintentar", action: onRetry)
                        .buttonStyle(.borderedProminent)

                    Button("Conexion", action: onOpenSettings)
                        .buttonStyle(.bordered)
                }
            }
            .padding(18)
            .background(.black.opacity(0.78), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(.white.opacity(0.12), lineWidth: 1)
            )
            .padding(.horizontal, 18)
            .padding(.bottom, 38)
        }
        .ignoresSafeArea(edges: .bottom)
    }
}

private struct SplashOverlay: View {
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color.black, Color(red: 0.08, green: 0.08, blue: 0.08)],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            VStack(spacing: 18) {
                Image("BrandIcon")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 112, height: 112)
                    .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                    .shadow(color: .white.opacity(0.12), radius: 24, x: 0, y: 10)

                Text("Global Imports")
                    .font(.system(size: 28, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)

                ProgressView()
                    .tint(.white)
                    .scaleEffect(1.1)
            }
            .padding(28)
        }
    }
}
