use wasm_bindgen::prelude::*;

/// Linear interpolation at (n - 1) * p. Input must be finite and nonempty.
fn percentile(sorted: &[f64], p: f64) -> f64 {
    let index = (sorted.len() - 1) as f64 * p;
    let low = index.floor() as usize;
    let high = index.ceil() as usize;
    sorted[low] + (sorted[high] - sorted[low]) * (index - low as f64)
}

/// [count, median, p95, p99, mean, population variance, min, max].
/// Empty output signals invalid data; never silently discard bad samples.
#[wasm_bindgen]
pub fn statistics(samples: &[f64]) -> Vec<f64> {
    if samples.is_empty() || samples.iter().any(|x| !x.is_finite() || *x <= 0.0) {
        return vec![];
    }
    let mut sorted = samples.to_vec();
    sorted.sort_by(f64::total_cmp);
    let mean = sorted.iter().sum::<f64>() / sorted.len() as f64;
    let variance = sorted.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / sorted.len() as f64;
    vec![
        sorted.len() as f64,
        percentile(&sorted, 0.5),
        percentile(&sorted, 0.95),
        percentile(&sorted, 0.99),
        mean,
        variance,
        sorted[0],
        sorted[sorted.len() - 1],
    ]
}

/// WGS84 geodetic degrees/metres to ECEF metres, double precision.
#[wasm_bindgen]
pub fn ecef(latitude: f64, longitude: f64, height: f64) -> Vec<f64> {
    let a = 6378137.0_f64;
    let f = 1.0 / 298.257223563_f64;
    let e2 = f * (2.0 - f);
    let lat = latitude.to_radians();
    let lon = longitude.to_radians();
    let n = a / (1.0 - e2 * lat.sin().powi(2)).sqrt();
    vec![
        (n + height) * lat.cos() * lon.cos(),
        (n + height) * lat.cos() * lon.sin(),
        (n * (1.0 - e2) + height) * lat.sin(),
    ]
}

/// Deterministic batched geodetic workload. One boundary crossing per batch.
#[wasm_bindgen]
pub fn ecef_batch(points: &[f64]) -> Vec<f64> {
    if points.len() % 3 != 0 {
        return vec![];
    }
    let mut output = Vec::with_capacity(points.len());
    for p in points.chunks_exact(3) {
        output.extend(ecef(p[0], p[1], p[2]));
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn interpolated_statistics() {
        let s = statistics(&[4., 1., 3., 2.]);
        assert_eq!(s[1], 2.5);
        assert!((s[2] - 3.85).abs() < 1e-12);
        assert!((s[3] - 3.97).abs() < 1e-12);
        assert_eq!(s[5], 1.25);
    }
    #[test]
    fn invalid_inputs() {
        for input in [
            vec![],
            vec![0.],
            vec![-1.],
            vec![f64::NAN],
            vec![f64::INFINITY],
        ] {
            assert!(statistics(&input).is_empty());
        }
    }
    #[test]
    fn single_value() {
        assert_eq!(statistics(&[5.]), vec![1., 5., 5., 5., 5., 0., 5., 5.]);
    }
    #[test]
    fn equator_and_pole() {
        let p = ecef(0., 0., 0.);
        assert!((p[0] - 6378137.).abs() < 1e-8);
        assert_eq!(p[1], 0.);
        let pole = ecef(90., 0., 0.);
        assert!((pole[2] - 6356752.314245179).abs() < 1e-6);
        let east = ecef(0., 90., 100.);
        assert!((east[1] - 6378237.).abs() < 1e-6);
    }
    #[test]
    fn batch_matches_scalar() {
        assert_eq!(ecef_batch(&[25., 121., 10.]), ecef(25., 121., 10.));
        assert!(ecef_batch(&[1.]).is_empty());
    }
}
