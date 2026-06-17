# Figma Community 公開情報案

最終更新: 2026-06-17

## 掲載基本情報

- プラグイン名: Yasuda Figma MCP
- 短い説明: GitHub Copilot から Figma の選択範囲を安全に読み取る、read-only MCP ブリッジ。
- タグ案: developer tools, ai, mcp, github copilot, screenshots, security, figjam
- カテゴリ案: Development / Productivity / AI workflows
- 対応エディタ: Figma Design, FigJam, Dev Mode
- ライセンス: MIT
- 作者: Rikuto Yasuda
- サポート導線: GitHub Issues かサポート用メールアドレスを掲載する

## 英語説明文案

Yasuda Figma MCP is a self-hosted, read-only Figma MCP bridge for GitHub Copilot. It renders screenshots inside your running Figma desktop app using the local plugin API, similar to Copy as PNG, and sends design data through your own private Codespaces tunnel.

Unlike REST image endpoints, screenshots are not uploaded to public S3 URLs. The plugin connects only to a loopback WebSocket bridge, uses token authentication, and exposes read-only tools for screenshots, metadata, design context, variables, local design system search, team-library variables, FigJam boards, document info, and current user/file info.

Use it when you want Copilot to inspect the Figma file you already have open without giving it a Figma REST token or generating public image URLs.

## 日本語説明文案

Yasuda Figma MCP は、GitHub Copilot から Figma の現在の選択範囲や開いているファイルを読み取るための、自前ホスト型 read-only MCP ブリッジです。スクリーンショットは Figma デスクトップアプリ内の plugin API でローカル描画され、Copy as PNG に近い経路で取得されます。

REST 画像エンドポイントと違い、スクリーンショットを公開 S3 URL にアップロードしません。プラグインは loopback の WebSocket bridge にだけ接続し、token 認証を使い、スクリーンショット、メタデータ、デザインコンテキスト、変数、ローカルデザインシステム検索、チームライブラリ変数、FigJam、ドキュメント情報、現在ユーザー/ファイル情報を read-only tool として提供します。

Figma REST token を渡さず、公開画像URLも作らずに、Copilot に開いているFigmaファイルを見せたいときに使います。

## 画像アセット

- アイコン: `assets/community/ai/icon-128.png`
- 高解像度アイコン: `assets/community/ai/icon-512.png`
- カバー画像: `assets/community/ai/cover-html-1920x960.png`
- カバーHTMLソース: `assets/community/html/cover.html`
- プレビュー画像 1: `assets/community/ai/preview-01-local-render-1600x1000.png`
- プレビュー画像 2: `assets/community/ai/preview-02-private-bridge-1600x1000.png`
- プレビュー画像 3: `assets/community/ai/preview-03-tools-1600x1000.png`

AI生成プレビュー画像は、画像内テキストの崩れを避けるため文字なしで作成しています。カバー画像だけは `assets/community/html/cover.html` で正確な文字を重ねてPNG化しています。

## 権限とネットワーク説明

- `permissions`: `currentuser`, `teamlibrary`
- `networkAccess.allowedDomains`: `ws://localhost:3055`
- 説明文案: Connects only to a loopback WebSocket bridge reached through a private, GitHub-authenticated `gh codespace ports forward` tunnel. No public endpoint and no third-party services.

## 公開前チェックリスト

- `plugin/manifest.json` の `id` は、Figma が発行した公開用 plugin ID `1648967381756219385` を設定済み。
- Figma公式ドキュメントに従い、`documentAccess` は `dynamic-page` を指定済み。
- 申請前に Figma デスクトップで `plugin/manifest.json` をImportし、接続、切断、再接続、未選択時、複数選択時、FigJam、巨大フレームの動作を確認する。
- `npm run build` を通す。
- 公開ページにはセットアップ手順として README の npx / tunnel / Connect の流れをリンクまたは要約する。
- サポート連絡先を必ず掲載する。
- 利用規約、Creator Agreement、Community Terms、必要に応じてPrivacy Policyを確認する。
- デザインデータやスクリーンショットをユーザー自身のCodespace/Copilot経路へ送るため、組織向け公開ではデータ処理の説明とプライバシーポリシーを用意する。

## Privacy / security disclosure 案

This plugin reads data only from the Figma file currently open in the user's Figma app. It does not call the Figma REST API, does not require a Figma API token, and does not upload screenshots to public image URLs. When connected, selected design data and locally rendered screenshots are sent through the user's loopback/private tunnel to their configured MCP bridge so GitHub Copilot can use the read-only tools. The bridge is token-authenticated and does not persist messages or files.

## 公式確認メモ

- Figma の manifest 公式ドキュメントでは、`manifest.json` が必須で、`documentAccess: "dynamic-page"` は新規プラグインに必要とされている。
- `networkAccess` を使う場合、許可ドメインの一覧がCommunityページに表示される。
- Figma の公開前ガイドラインでは、十分なテスト、サポート連絡先、法務/プライバシー文書の確認、正確な説明とプレビュー、パフォーマンス、外部接続の明示が求められる。
