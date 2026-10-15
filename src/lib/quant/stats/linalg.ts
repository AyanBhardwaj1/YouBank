/**
 * Small dense linear algebra for the quant kit: products, a pivoted inverse and solve, Cholesky, and the
 * symmetric eigen-decomposition (cyclic Jacobi) the shrinkage, risk-model and Johansen code need. Matrices
 * are arrays of rows. Sizes here are tens to a few hundred, where these simple methods are exact enough.
 */
export type Mat = number[][];

export const zeros = (r: number, c: number): Mat => Array.from({ length: r }, () => new Array<number>(c).fill(0));
export const eye = (n: number): Mat => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
export const transpose = (A: Mat): Mat => (A.length ? A[0].map((_, j) => A.map((r) => r[j])) : []);

export function matmul(A: Mat, B: Mat): Mat {
  const n = A.length, m = B[0]?.length ?? 0, k = B.length;
  const C = zeros(n, m);
  for (let i = 0; i < n; i++) for (let p = 0; p < k; p++) { const a = A[i][p]; if (a === 0) continue; const Bp = B[p], Ci = C[i]; for (let j = 0; j < m; j++) Ci[j] += a * Bp[j]; }
  return C;
}

export const matvec = (A: Mat, x: ArrayLike<number>): number[] => A.map((r) => { let s = 0; for (let j = 0; j < r.length; j++) s += r[j] * x[j]; return s; });
export const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
/** x' A x */
export const quad = (A: Mat, x: ArrayLike<number>) => dot(x, matvec(A, x));

/** Inverse by Gauss-Jordan with partial pivoting; null when singular. */
export function inverse(A: Mat): Mat | null {
  const n = A.length;
  const M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c];
    for (let j = 0; j < 2 * n; j++) M[c][j] /= piv;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((r) => r.slice(n));
}

/** Solve A x = b (pivoted elimination); null when singular. */
export function solve(A: Mat, b: ArrayLike<number>): number[] | null {
  const inv = inverse(A);
  return inv ? matvec(inv, b) : null;
}

/** Lower-triangular L with A = L L'; null when A is not positive definite. */
export function cholesky(A: Mat): Mat | null {
  const n = A.length, L = zeros(n, n);
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = A[i][j];
    for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
    if (i === j) { if (s <= 0) return null; L[i][i] = Math.sqrt(s); } else L[i][j] = s / L[j][j];
  }
  return L;
}

/**
 * Eigenvalues and eigenvectors of a symmetric matrix by cyclic Jacobi rotations, sorted from largest.
 * `vectors[k]` is the unit eigenvector of `values[k]`.
 */
export function eigSym(S: Mat, maxSweeps = 100): { values: number[]; vectors: Mat } {
  const n = S.length;
  const A = S.map((r) => [...r]);
  const V = eye(n);
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) {
        const akp = A[k][p], akq = A[k][q];
        A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < n; k++) {
        const apk = A[p][k], aqk = A[q][k];
        A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < n; k++) {
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const order = A.map((r, i) => [r[i], i] as const).sort((a, b) => b[0] - a[0]);
  return { values: order.map(([v]) => v), vectors: order.map(([, i]) => V.map((r) => r[i])) };
}

/** The symmetric square root and inverse square root of a positive definite matrix. */
export function sqrtSym(S: Mat, inverse = false): Mat {
  const { values, vectors } = eigSym(S);
  const n = S.length, R = zeros(n, n);
  values.forEach((l, k) => {
    const f = inverse ? 1 / Math.sqrt(Math.max(l, 1e-300)) : Math.sqrt(Math.max(l, 0));
    const v = vectors[k];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) R[i][j] += f * v[i] * v[j];
  });
  return R;
}

/** Sample covariance of the columns of a T x N matrix (rows are observations), with `ddof` (1 by default). */
export function covariance(X: Mat, ddof = 1): Mat {
  const T = X.length, N = X[0]?.length ?? 0;
  const m = new Array<number>(N).fill(0);
  for (const r of X) for (let j = 0; j < N; j++) m[j] += r[j] / T;
  const S = zeros(N, N);
  for (const r of X) for (let i = 0; i < N; i++) { const di = r[i] - m[i]; if (di === 0) continue; for (let j = i; j < N; j++) S[i][j] += di * (r[j] - m[j]); }
  for (let i = 0; i < N; i++) for (let j = i; j < N; j++) { S[i][j] /= T - ddof; S[j][i] = S[i][j]; }
  return S;
}

/** Correlation matrix from a covariance matrix. */
export function toCorrelation(S: Mat): Mat {
  const d = S.map((r, i) => Math.sqrt(Math.max(r[i], 0)));
  return S.map((r, i) => r.map((v, j) => (d[i] > 0 && d[j] > 0 ? v / (d[i] * d[j]) : i === j ? 1 : 0)));
}
