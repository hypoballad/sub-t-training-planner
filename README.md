# Sub-T Training Planner

5 km タイム、COROS 閾値ペース、または手動指定から、サブスレッショルド練習の目安と週間・長期プランを見る日本語の静的 Web アプリです。HTML、CSS、Vanilla JavaScript の ES Modules で動作します。入力と選択した計算方式はブラウザの localStorage に保存されます。初期選択は5 kmタイム基準です。

## ローカルで開く

Node.js 22 以上を使用します。展開したフォルダで次のコマンドを実行し、ブラウザで [ローカルプレビュー](http://127.0.0.1:4173/) を開きます。

```sh
node tools/serve.mjs
```

開発サーバーの終了は Ctrl+C です。ES Modules を読み込むため、ブラウザからは HTTP 経由で開いてください。パッケージのインストールは不要です。

## 動作テスト

```sh
node --test
```

## GitHub Pages

フォルダの内容をリポジトリのルートに置いてください。隠しディレクトリの `.github` も含めます。リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** に設定すると、`main` への push または Actions タブからの手動実行で公開できます。ワークフローは Node.js の計算テストに成功した後、アプリのファイルだけを Pages に送ります。公開 URL は GitHub の Pages 設定とデプロイ結果で確認できます。[GitHub Pages の公式手順](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

ブランチ公開を利用する場合は **Deploy from a branch → main → /(root)** を選択します。Jekyll を省くため空の `.nojekyll` を含めています。すべてのアプリ内アセットは相対パスです。[公開元の設定](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## 計算根拠と適用範囲

- 書籍 *Norwegian Singles Method: Subthreshold Running Kept Simple* の表 1.3、1.4、1.5〜2.2、2.5〜3.2、およびレース前調整の章を参照しました。画像で確認した計算用の数値を収録しています。
- 選択した方式の 5 km タイムを表 1.4（15:00〜30:00）に当てはめ、隣接点を秒単位で線形補間します。手動指定では3・6・10分反復の入力値を使います。
- COROS 閾値ペース基準は、閾値ペースを一定時間維持できると仮定し、Riegel モデルで5 kmタイムを推定します。初期値は60分と指数1.06です。詳細設定の持続時間と指数で調整できます。この換算は本書およびCOROS公式の指定式ではありません。COROS の5 kmレース予測タイムを計算元に選ぶと、そのタイムから表 1.4 で計算します。
- 週間プランはアプリによる再計算です。日数や1日あたりの上限のため割り当てられない時間は画面に表示します。週間時間の未入力時はサンプルの前提として5時間を使用します。
- 標準の4週維持、3週ごとに15分追加、増分の Sub-T 20%、10%超の増加警告はアプリのルールです。実際の Sub-T は反復単位です。フルのロングラン上限に使う予想完走時間は任意入力です。
- 書籍の週例は掲載時間で表示し、5・11・12分反復や朝夕2回の記載も保持します。配布物には書籍のOCR全文と画像は含まれていません。
