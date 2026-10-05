export interface Letter { ch: string; fix: boolean }

/** Letters of the expected answer, marking those the learner missed or mistyped (LCS alignment). */
export function typoLetters(given: string, expected: string): Letter[] {
  const a = given.toLowerCase();
  const b = expected;
  const bl = b.toLowerCase();
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === bl[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: Letter[] = [];
  let i = 0;
  for (let j = 0; j < b.length; j++) {
    if (i < a.length && a[i] === bl[j]) { out.push({ ch: b[j], fix: false }); i++; continue; }
    while (i < a.length && dp[i + 1][j] >= dp[i][j + 1] && a[i] !== bl[j]) i++;
    if (i < a.length && a[i] === bl[j]) { out.push({ ch: b[j], fix: false }); i++; } else out.push({ ch: b[j], fix: true });
  }
  return out;
}
