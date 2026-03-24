import SwiftUI

struct ContentView: View {
    @AppStorage("webAppURL") private var webAppURL = "http://172.20.10.2:10000/app/"
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
            loadCurrentURL()
        }
        .onChange(of: webAppURL) { _ in
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

                        Button("Usar localhost del simulador") {
                            draftURL = "http://localhost:10000/app/"
                        }

                        Button("Usar IP local del Mac") {
                            draftURL = "http://172.20.10.2:10000/app/"
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
        guard let resolvedURL else { return }
        webViewStore.load(resolvedURL)
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
