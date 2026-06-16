# Contributing

ご関心ありがとうございます。

## 開発フロー

1. Issue で提案・不具合を共有
2. fork → feature ブランチ
3. `npm ci && npm run bundle` でビルド確認
4. Pull Request（変更内容・動機・テスト結果を記載）

## 必須ルール

- **機密情報を含めない**: 接続情報・トークン・顧客名・社名・内部ホスト名・本番接続先を
  コード/README/サンプル/コミット履歴に入れないこと。サンプルは中立なプレースホルダ
  （`example.com` / `TENANT_A` 等）を使用。
- コミット前に secret スキャンが通ること（`gitleaks detect`）。CI でも検査します。
- ライセンスは Apache-2.0。新規ファイルには必要に応じて SPDX ヘッダ
  `// SPDX-License-Identifier: Apache-2.0` を付与。

## DCO / 署名

コミットは `git commit -s`（Signed-off-by）を推奨します。
