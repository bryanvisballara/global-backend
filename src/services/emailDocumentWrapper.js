function wrapDarkEmailDocument(content) {
  return `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="dark" />
    <meta name="supported-color-schemes" content="dark" />
    <style>
      :root {
        color-scheme: dark;
        supported-color-schemes: dark;
      }

      html,
      body {
        margin: 0 !important;
        padding: 0 !important;
        background: #060606 !important;
        color: #f6f4ef !important;
      }

      body {
        -webkit-text-size-adjust: 100%;
        -ms-text-size-adjust: 100%;
      }

      .email-root,
      .email-root div,
      .email-root p,
      .email-root span,
      .email-root strong,
      .email-root h1,
      .email-root a {
        -webkit-text-fill-color: currentColor !important;
      }

      .em-heading,
      .email-root h1 {
        color: #fffffe !important;
        -webkit-text-fill-color: #fffffe !important;
      }

      .em-body,
      .em-accent {
        color: #fffaf0 !important;
        -webkit-text-fill-color: #fffaf0 !important;
      }

      .em-secondary {
        color: #e8e0d4 !important;
        -webkit-text-fill-color: #e8e0d4 !important;
      }

      .em-muted {
        color: #d7d0c5 !important;
        -webkit-text-fill-color: #d7d0c5 !important;
      }

      .em-gold {
        color: #ffd985 !important;
        -webkit-text-fill-color: #ffd985 !important;
      }

      .em-strong {
        color: #fffffe !important;
        -webkit-text-fill-color: #fffffe !important;
      }

      .em-btn {
        color: #15110a !important;
        -webkit-text-fill-color: #15110a !important;
      }

      .email-root [style*="color:#ffffff"],
      .email-root [style*="color: #ffffff"] {
        color: #fffffe !important;
        -webkit-text-fill-color: #fffffe !important;
      }

      .email-root [style*="color:#f7f7f4"],
      .email-root [style*="color: #f7f7f4"],
      .email-root [style*="color:#f6f4ef"],
      .email-root [style*="color: #f6f4ef"],
      .email-root [style*="color:#f2eee5"],
      .email-root [style*="color: #f2eee5"] {
        color: #fffaf0 !important;
        -webkit-text-fill-color: #fffaf0 !important;
      }

      .email-root [style*="color:#c9c3b8"],
      .email-root [style*="color: #c9c3b8"],
      .email-root [style*="color:#b8b3aa"],
      .email-root [style*="color: #b8b3aa"] {
        color: #e8e0d4 !important;
        -webkit-text-fill-color: #e8e0d4 !important;
      }

      .email-root [style*="color:#a9a49a"],
      .email-root [style*="color: #a9a49a"],
      .email-root [style*="color:#8f908f"],
      .email-root [style*="color: #8f908f"] {
        color: #d7d0c5 !important;
        -webkit-text-fill-color: #d7d0c5 !important;
      }

      .email-root [style*="color:#f1d9a6"],
      .email-root [style*="color: #f1d9a6"] {
        color: #ffd985 !important;
        -webkit-text-fill-color: #ffd985 !important;
      }

      @media (prefers-color-scheme: dark) {
        body,
        .email-root {
          background: #060606 !important;
        }

        .email-root .em-heading,
        .email-root h1,
        .email-root .em-strong,
        .email-root strong.em-strong {
          color: #fffffe !important;
          -webkit-text-fill-color: #fffffe !important;
        }

        .email-root .em-body,
        .email-root .em-accent {
          color: #fffaf0 !important;
          -webkit-text-fill-color: #fffaf0 !important;
        }

        .email-root .em-secondary {
          color: #e8e0d4 !important;
          -webkit-text-fill-color: #e8e0d4 !important;
        }

        .email-root .em-muted {
          color: #d7d0c5 !important;
          -webkit-text-fill-color: #d7d0c5 !important;
        }

        .email-root .em-gold {
          color: #ffd985 !important;
          -webkit-text-fill-color: #ffd985 !important;
        }
      }

      [data-ogsc] body,
      [data-ogsc] .email-root,
      [data-ogsb] body,
      [data-ogsb] .email-root {
        background: #060606 !important;
      }

      [data-ogsc] .email-root .em-heading,
      [data-ogsc] .email-root h1,
      [data-ogsb] .email-root .em-heading,
      [data-ogsb] .email-root h1,
      [data-ogsc] .email-root .em-strong,
      [data-ogsb] .email-root .em-strong {
        color: #fffffe !important;
        -webkit-text-fill-color: #fffffe !important;
      }

      [data-ogsc] .email-root .em-body,
      [data-ogsc] .email-root .em-accent,
      [data-ogsb] .email-root .em-body,
      [data-ogsb] .email-root .em-accent {
        color: #fffaf0 !important;
        -webkit-text-fill-color: #fffaf0 !important;
      }

      [data-ogsc] .email-root .em-secondary,
      [data-ogsb] .email-root .em-secondary {
        color: #e8e0d4 !important;
        -webkit-text-fill-color: #e8e0d4 !important;
      }

      [data-ogsc] .email-root .em-muted,
      [data-ogsb] .email-root .em-muted {
        color: #d7d0c5 !important;
        -webkit-text-fill-color: #d7d0c5 !important;
      }

      [data-ogsc] .email-root .em-gold,
      [data-ogsb] .email-root .em-gold {
        color: #ffd985 !important;
        -webkit-text-fill-color: #ffd985 !important;
      }
    </style>
  </head>
  <body bgcolor="#060606" style="margin:0;padding:0;background:#060606 !important;color:#f6f4ef !important;">
    <div class="email-root" bgcolor="#060606" style="margin:0;padding:0;background:#060606 !important;color:#f6f4ef !important;">${content}</div>
  </body>
</html>`;
}

module.exports = {
  wrapDarkEmailDocument,
};
