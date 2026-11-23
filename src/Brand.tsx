/** The mark is a tiny dot-matrix bar chart: the same dots the landing page is drawn with. */
export function BrandMark({ size = 26 }: { size?: number }) {
  const cols = [[2], [0, 1, 2], [1, 2]]; // rows lit per column, 0 = top
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {cols.flatMap((rowsLit, c) => rowsLit.map((r) => (
        <circle key={`${c}-${r}`} cx={5 + c * 7} cy={5 + r * 7} r={2.6} fill={c === 1 && r === 0 ? "#eb6834" : "currentColor"} />
      )))}
    </svg>
  );
}
