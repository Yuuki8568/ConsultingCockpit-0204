/**
 * マスクモード用の包み。
 * 企業名・金額・面談メモなど、画面共有や外出先で見せたくないものを囲う。
 *
 * 中身を押して外せるようにはしていない。表の行や一覧の項目そのものが
 * 押せる場所にあるため、うっかり伏せが外れる・押し間違えるほうが危ないと判断した。
 * 確認したいときは上部の「伏せ中」を押してモードごと戻す（カーソルを乗せると少しだけ薄くなる）。
 */
import { useVault } from "../hooks/use-vault";

export function Mask({ children }: { children: React.ReactNode }) {
  const { masked } = useVault();
  if (!masked) return <span>{children}</span>;
  return (
    <span className="masked" title="伏せています。上部の「伏せ中」を押すと表示に戻ります">
      {children}
    </span>
  );
}
