// Expo の標準 Babel 設定 ＋ 不足分の構文変換。
// 依存パッケージ（@orpc/client など）にクラス内 static ブロックが含まれており、
// これを変換するプラグインが既定の組み合わせに入っていないため、
// 明示的に足してバンドルが失敗しないようにしている。
module.exports = (api) => {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: ["@babel/plugin-transform-class-static-block"],
  };
};
