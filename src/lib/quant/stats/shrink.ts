/**
 * QF2: Ledoit and Wolf (2004), "Honey, I shrunk the sample covariance matrix": shrinkage of the sample
 * covariance toward a constant-correlation target, with the optimal intensity estimated from the data. A
 * sample covariance of many assets over few days is noisy, and its inverse (which risk parity and Kelly use)
 * amplifies the noise; shrinkage trades a little bias for much less error. Pure.
 *
 * Follows Ledoit and Wolf's covCor.m: moments with 1/T, target F with F_ii = S_ii and F_ij = r̄·√(S_ii·S_jj)
 * (r̄ the average sample correlation), intensity δ = max(0, min(1, κ/T)) with κ = (π - ρ)/γ.
 */
import type { Mat } from "./linalg";

export type Shrunk = { cov: Mat; shrinkage: number; target: Mat; sample: Mat; avgCorrelation: number };

/** `X` is T x N (rows = periods, columns = assets). */
export function ledoitWolf(X: Mat): Shrunk {
  const T = X.length, N = X[0]?.length ?? 0;
  if (T < 2 || N < 1) throw new Error("Ledoit-Wolf needs at least two observations");
  const m = new Array<number>(N).fill(0);
  for (const r of X) for (let j = 0; j < N; j++) m[j] += r[j] / T;
  const Y = X.map((r) => r.map((v, j) => v - m[j]));
  const S: Mat = Array.from({ length: N }, () => new Array<number>(N).fill(0));
  for (const r of Y) for (let i = 0; i < N; i++) for (let j = i; j < N; j++) S[i][j] += (r[i] * r[j]) / T;
  for (let i = 0; i < N; i++) for (let j = 0; j < i; j++) S[i][j] = S[j][i];
  const sd = S.map((r, i) => Math.sqrt(Math.max(r[i], 0)));
  let rbar = 0;
  if (N > 1) {
    let s = 0;
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) s += sd[i] > 0 && sd[j] > 0 ? S[i][j] / (sd[i] * sd[j]) : 0;
    rbar = (2 * s) / (N * (N - 1));
  }
  const F = S.map((r, i) => r.map((v, j) => (i === j ? v : rbar * sd[i] * sd[j])));
  // π: sum of asymptotic variances of the sample covariances.
  const Y2 = Y.map((r) => r.map((v) => v * v));
  let pi = 0;
  const piDiag = new Array<number>(N).fill(0);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    let s = 0;
    for (let t = 0; t < T; t++) { const d = Y[t][i] * Y[t][j] - S[i][j]; s += d * d; }
    s /= T;
    pi += s;
    if (i === j) piDiag[i] = s;
  }
  // ρ: the diagonal part plus the off-diagonal θ terms.
  let rho = piDiag.reduce((a, b) => a + b, 0);
  if (N > 1) {
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      if (i === j || !(sd[i] > 0 && sd[j] > 0)) continue;
      let tii = 0, tjj = 0;
      for (let t = 0; t < T; t++) {
        const cross = Y[t][i] * Y[t][j] - S[i][j];
        tii += (Y2[t][i] - S[i][i]) * cross;
        tjj += (Y2[t][j] - S[j][j]) * cross;
      }
      tii /= T; tjj /= T;
      rho += (rbar / 2) * ((sd[j] / sd[i]) * tii + (sd[i] / sd[j]) * tjj);
    }
  }
  let gamma = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) gamma += (F[i][j] - S[i][j]) ** 2;
  const kappa = gamma > 0 ? (pi - rho) / gamma : 0;
  const shrinkage = gamma > 0 ? Math.max(0, Math.min(1, kappa / T)) : 0;
  const cov = S.map((r, i) => r.map((v, j) => shrinkage * F[i][j] + (1 - shrinkage) * v));
  return { cov, shrinkage, target: F, sample: S, avgCorrelation: rbar };
}
