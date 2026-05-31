/**
 * Three.js 軽量モック (テスト用)
 * DOM / WebGL に依存しない純粋な数学クラスのみ提供します。
 * Three.js の実際の実装に合わせて動作を検証済みのメソッドのみ実装してください。
 */

export class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x, y, z) {
    this.x = x; this.y = y; this.z = z;
    return this;
  }

  copy(v) {
    this.x = v.x; this.y = v.y; this.z = v.z;
    return this;
  }

  clone() {
    return new Vector3(this.x, this.y, this.z);
  }

  add(v) {
    this.x += v.x; this.y += v.y; this.z += v.z;
    return this;
  }

  sub(v) {
    this.x -= v.x; this.y -= v.y; this.z -= v.z;
    return this;
  }

  subVectors(a, b) {
    this.x = a.x - b.x;
    this.y = a.y - b.y;
    this.z = a.z - b.z;
    return this;
  }

  addVectors(a, b) {
    this.x = a.x + b.x;
    this.y = a.y + b.y;
    this.z = a.z + b.z;
    return this;
  }

  multiplyScalar(s) {
    this.x *= s; this.y *= s; this.z *= s;
    return this;
  }

  distanceTo(v) {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  normalize() {
    const l = this.length();
    if (l > 0) { this.x /= l; this.y /= l; this.z /= l; }
    return this;
  }

  dot(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  fromArray(arr, offset = 0) {
    this.x = arr[offset]; this.y = arr[offset + 1]; this.z = arr[offset + 2];
    return this;
  }

  applyMatrix4(m) {
    const x = this.x, y = this.y, z = this.z;
    const e = m.elements;
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    this.x = (e[0] * x + e[4] * y + e[8]  * z + e[12]) * w;
    this.y = (e[1] * x + e[5] * y + e[9]  * z + e[13]) * w;
    this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
    return this;
  }

  setFromMatrixPosition(m) {
    const e = m.elements;
    this.x = e[12]; this.y = e[13]; this.z = e[14];
    return this;
  }

  project(camera) {
    return this.applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
  }
}

export class Vector2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  clone() { return new Vector2(this.x, this.y); }
  distanceTo(v) {
    return Math.sqrt((this.x - v.x) ** 2 + (this.y - v.y) ** 2);
  }
}

export class Matrix4 {
  constructor() {
    // column-major (Three.js convention)
    this.elements = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
  }

  identity() {
    this.elements = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    return this;
  }

  copy(m) {
    this.elements = [...m.elements];
    return this;
  }

  clone() {
    const m = new Matrix4();
    m.elements = [...this.elements];
    return m;
  }

  invert() {
    // Only correct for pure rotation + translation matrices (orthogonal)
    const e = this.elements;
    const n = new Float64Array(16);
    const m00=e[0],m10=e[1],m20=e[2],m30=e[3];
    const m01=e[4],m11=e[5],m21=e[6],m31=e[7];
    const m02=e[8],m12=e[9],m22=e[10],m32=e[11];
    const m03=e[12],m13=e[13],m23=e[14],m33=e[15];

    n[0]  =  m11*m22*m33 - m11*m23*m32 - m21*m12*m33 + m21*m13*m32 + m31*m12*m23 - m31*m13*m22;
    n[4]  = -m01*m22*m33 + m01*m23*m32 + m21*m02*m33 - m21*m03*m32 - m31*m02*m23 + m31*m03*m22;
    n[8]  =  m01*m12*m33 - m01*m13*m32 - m11*m02*m33 + m11*m03*m32 + m31*m02*m13 - m31*m03*m12;
    n[12] = -m01*m12*m23 + m01*m13*m22 + m11*m02*m23 - m11*m03*m22 - m21*m02*m13 + m21*m03*m12;
    n[1]  = -m10*m22*m33 + m10*m23*m32 + m20*m12*m33 - m20*m13*m32 - m30*m12*m23 + m30*m13*m22;
    n[5]  =  m00*m22*m33 - m00*m23*m32 - m20*m02*m33 + m20*m03*m32 + m30*m02*m23 - m30*m03*m22;
    n[9]  = -m00*m12*m33 + m00*m13*m32 + m10*m02*m33 - m10*m03*m32 - m30*m02*m13 + m30*m03*m12;
    n[13] =  m00*m12*m23 - m00*m13*m22 - m10*m02*m23 + m10*m03*m22 + m20*m02*m13 - m20*m03*m12;
    n[2]  =  m10*m21*m33 - m10*m23*m31 - m20*m11*m33 + m20*m13*m31 + m30*m11*m23 - m30*m13*m21;
    n[6]  = -m00*m21*m33 + m00*m23*m31 + m20*m01*m33 - m20*m03*m31 - m30*m01*m23 + m30*m03*m21;
    n[10] =  m00*m11*m33 - m00*m13*m31 - m10*m01*m33 + m10*m03*m31 + m30*m01*m13 - m30*m03*m11;
    n[14] = -m00*m11*m23 + m00*m13*m21 + m10*m01*m23 - m10*m03*m21 - m20*m01*m13 + m20*m03*m11;
    n[3]  = -m10*m21*m32 + m10*m22*m31 + m20*m11*m32 - m20*m12*m31 - m30*m11*m22 + m30*m12*m21;
    n[7]  =  m00*m21*m32 - m00*m22*m31 - m20*m01*m32 + m20*m02*m31 + m30*m01*m22 - m30*m02*m21;
    n[11] = -m00*m11*m32 + m00*m12*m31 + m10*m01*m32 - m10*m02*m31 - m30*m01*m12 + m30*m02*m11;
    n[15] =  m00*m11*m22 - m00*m12*m21 - m10*m01*m22 + m10*m02*m21 + m20*m01*m12 - m20*m02*m11;

    const det = m00*n[0] + m10*n[4] + m20*n[8] + m30*n[12];
    if (Math.abs(det) < 1e-15) return this; // singular
    const invDet = 1 / det;
    this.elements = Array.from(n).map(v => v * invDet);
    return this;
  }

  multiply(m) {
    const a = this.elements, b = m.elements, r = new Array(16);
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          sum += a[k * 4 + row] * b[col * 4 + k];
        }
        r[col * 4 + row] = sum;
      }
    }
    this.elements = r;
    return this;
  }

  makeRotationY(theta) {
    const c = Math.cos(theta), s = Math.sin(theta);
    this.elements = [
       c, 0, s, 0,
       0, 1, 0, 0,
      -s, 0, c, 0,
       0, 0, 0, 1,
    ];
    return this;
  }

  setPosition(x, y, z) {
    this.elements[12] = x;
    this.elements[13] = y;
    this.elements[14] = z;
    return this;
  }

  extractRotation(m) {
    const e = m.elements;
    const sx = 1 / new Vector3(e[0], e[1], e[2]).length();
    const sy = 1 / new Vector3(e[4], e[5], e[6]).length();
    const sz = 1 / new Vector3(e[8], e[9], e[10]).length();
    this.elements = [
      e[0]*sx, e[1]*sx, e[2]*sx, 0,
      e[4]*sy, e[5]*sy, e[6]*sy, 0,
      e[8]*sz, e[9]*sz, e[10]*sz, 0,
      0, 0, 0, 1
    ];
    return this;
  }
}

export class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x; this.y = y; this.z = z; this.w = w;
  }

  set(x, y, z, w) {
    this.x = x; this.y = y; this.z = z; this.w = w;
    return this;
  }

  copy(q) {
    this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w;
    return this;
  }

  clone() { return new Quaternion(this.x, this.y, this.z, this.w); }

  normalize() {
    const l = Math.sqrt(this.x**2 + this.y**2 + this.z**2 + this.w**2);
    if (l > 0) { this.x /= l; this.y /= l; this.z /= l; this.w /= l; }
    return this;
  }

  multiply(q) {
    const ax = this.x, ay = this.y, az = this.z, aw = this.w;
    const bx = q.x, by = q.y, bz = q.z, bw = q.w;
    this.x = ax*bw + aw*bx + ay*bz - az*by;
    this.y = ay*bw + aw*by + az*bx - ax*bz;
    this.z = az*bw + aw*bz + ax*by - ay*bx;
    this.w = aw*bw - ax*bx - ay*by - az*bz;
    return this;
  }

  premultiply(q) {
    return this.multiplyQuaternions(q, this);
  }

  multiplyQuaternions(a, b) {
    const ax = a.x, ay = a.y, az = a.z, aw = a.w;
    const bx = b.x, by = b.y, bz = b.z, bw = b.w;
    this.x = ax*bw + aw*bx + ay*bz - az*by;
    this.y = ay*bw + aw*by + az*bx - ax*bz;
    this.z = az*bw + aw*bz + ax*by - ay*bx;
    this.w = aw*bw - ax*bx - ay*by - az*bz;
    return this;
  }

  invert() {
    this.x = -this.x; this.y = -this.y; this.z = -this.z;
    return this;
  }

  setFromRotationMatrix(m) {
    const e = m.elements;
    const m11=e[0], m12=e[4], m13=e[8];
    const m21=e[1], m22=e[5], m23=e[9];
    const m31=e[2], m32=e[6], m33=e[10];
    const trace = m11 + m22 + m33;
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1);
      this.w = 0.25 / s;
      this.x = (m32 - m23) * s;
      this.y = (m13 - m31) * s;
      this.z = (m21 - m12) * s;
    } else if (m11 > m22 && m11 > m33) {
      const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
      this.w = (m32 - m23) / s; this.x = 0.25 * s;
      this.y = (m12 + m21) / s; this.z = (m13 + m31) / s;
    } else if (m22 > m33) {
      const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
      this.w = (m13 - m31) / s; this.x = (m12 + m21) / s;
      this.y = 0.25 * s; this.z = (m23 + m32) / s;
    } else {
      const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
      this.w = (m21 - m12) / s; this.x = (m13 + m31) / s;
      this.y = (m23 + m32) / s; this.z = 0.25 * s;
    }
    return this;
  }

  dot(q) {
    return this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w;
  }

  toArray() { return [this.x, this.y, this.z, this.w]; }

  /**
   * Convert a 3x3 rotation matrix (mat3 row-major flat array) to quaternion.
   * This mirrors the GLSL quatFromMat3 logic in gvrm.js gsCustomizeMaterial.
   *
   * mat3 layout (row-major): [m00, m01, m02, m10, m11, m12, m20, m21, m22]
   */
  static fromMat3RowMajor(mat3) {
    const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = mat3;
    const trace = m00 + m11 + m22;
    let x, y, z, w;
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1);
      w = 0.25 / s;
      x = (m21 - m12) * s;
      y = (m02 - m20) * s;
      z = (m10 - m01) * s;
    } else if (m00 > m11 && m00 > m22) {
      const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
      w = (m21 - m12) / s; x = 0.25 * s;
      y = (m01 + m10) / s; z = (m02 + m20) / s;
    } else if (m11 > m22) {
      const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
      w = (m02 - m20) / s; x = (m01 + m10) / s;
      y = 0.25 * s; z = (m12 + m21) / s;
    } else {
      const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
      w = (m10 - m01) / s; x = (m02 + m20) / s;
      y = (m12 + m21) / s; z = 0.25 * s;
    }
    return new Quaternion(x, y, z, w).normalize();
  }
}

/** Float32Array-backed BufferAttribute mock */
export class BufferAttribute {
  constructor(array, itemSize) {
    this.array = array;
    this.itemSize = itemSize;
    this.count = array.length / itemSize;
  }
  getX(i) { return this.array[i * this.itemSize + 0]; }
  getY(i) { return this.array[i * this.itemSize + 1]; }
  getZ(i) { return this.array[i * this.itemSize + 2]; }
  getW(i) { return this.array[i * this.itemSize + 3]; }
}

export const DataTexture = class {
  constructor(data, width, height) {
    this.image = { data, width, height };
    this.needsUpdate = false;
  }
};

export const Float32BufferAttribute = BufferAttribute;

/** 最小限の THREE 名前空間 */
const THREE = { Vector3, Vector2, Matrix4, Quaternion, BufferAttribute, Float32BufferAttribute, DataTexture };
export default THREE;
