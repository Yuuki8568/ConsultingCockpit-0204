/**
 * 別のサイトの枠（iframe）に埋め込まれて操作されるのを防ぐ。
 * 枠の中で開かれた場合は、中身を出さずに自分自身を最上位で開き直す。
 * （Content-Security-Policy の frame-ancestors は meta で書いてもブラウザに
 *   無視されるため、このスクリプトで受け止める）
 * 外部ファイルに置いているのは、本番の CSP から 'unsafe-inline' を
 * 外せるようにするため。
 */
if (window.top !== window.self) {
  document.documentElement.innerHTML =
    '<body style="background:#0C0C0C;color:#fff;font-family:sans-serif;padding:24px">この画面は他のサイトの中では開けません。</body>';
  try {
    window.top.location = window.self.location.href;
  } catch (e) {
    /* 別サイトの枠内では書き換えを断られる。表示を止めるだけで十分。 */
  }
}