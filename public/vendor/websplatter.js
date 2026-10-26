// vendor/websplatter/src/shaders/preprocess_f16.wgsl
var preprocess_f16_default = "enable f16;\n\nstruct GeneralInfo{\n  keys_size : u32, dispatch_x: u32, dispatch_y: u32, dispatch_z: u32,\n  l0_x : u32, l0_y : u32, l0_z : u32, l0_t : u32,\n  l1_x : u32, l1_y : u32, l1_z : u32, l1_t : u32,\n};\n\nconst WG_SIZE = 256u;\n\nconst PI: f32 = acos(-1.0);\n\nconst SH_C0: f16 = f16(sqrt(1.0 / (4.0 * PI)));\n\nconst SH_C1: f16 = f16(sqrt(3.0 / (4.0 * PI)));\n\nconst SH_C2: array<f16, 5> = array<f16, 5>(\n    f16(sqrt(15.0 / (4.0 * PI))),\n    f16(-sqrt(15.0 / (4.0 * PI))),\n    f16(sqrt(5.0 / (16.0 * PI))),\n    f16(-sqrt(15.0 / (4.0 * PI))),\n    f16(sqrt(15.0 / (16.0 * PI)))\n);\n\nconst SH_C3: array<f16, 7> = array<f16, 7>(\n    f16(-sqrt(35.0 / (32.0 * PI))),\n    f16(sqrt(105.0 / (4.0 * PI))),\n    f16(-sqrt(21.0 / (32.0 * PI))),\n    f16(sqrt(7.0 / (16.0 * PI))),\n    f16(-sqrt(21.0 / (32.0 * PI))),\n    f16(sqrt(105.0 / (16.0 * PI))),\n    f16(-sqrt(35.0 / (32.0 * PI)))\n);\n\nstruct CameraUniforms {\n    view: mat4x4<f32>,\n    view_inv: mat4x4<f32>,\n    proj: mat4x4<f32>,\n    proj_inv: mat4x4<f32>,\n    viewport: vec2<f32>,\n    focal: vec2<f32>\n};\n\nstruct SHSolver {\n    dir_xy: vec2<f16>,\n    dir_z_opacity: vec2<f16>,\n    idx: u32,\n};\n\nstruct RenderSettings {\n    canvas_size: vec2<u32>,\n    max_sh_deg: u32,\n    cur_sh_deg: u32,\n    gaussian_scaling: f32,\n    kernel_size: f32,\n    mip_spatting: u32,\n    walltime: f32,\n};\n\nstruct SH_RGB {\n    r: f16,\n    g: f16,\n    b: f16,\n};\n\n@group(0) @binding(0) var<uniform> camera: CameraUniforms;\n@group(0) @binding(1) var<uniform> render_settings: RenderSettings;\n\n@group(1) @binding(0) var<storage, read> sort_infos: GeneralInfo;\n@group(1) @binding(1) var<storage, read> sh_coefs : array<SH_RGB>;\n@group(1) @binding(2) var<storage, read> sh_solvers : array<SHSolver>;\n@group(1) @binding(3) var<storage, read_write> colors : array<vec2<u32>>;\n\nfn sh_coef(idx: u32) -> vec3<f16> {\n    let sh = sh_coefs[idx];\n    return vec3<f16>(sh.r, sh.g, sh.b);\n}\n\nfn evaluate_sh(dir: vec3<f16>, v_idx: u32, max_sh_deg: u32, sh_deg: u32) -> vec3<f16> {\n    let sh_base = (max_sh_deg + 1u) * (max_sh_deg + 1u) * v_idx;\n\n    var result = SH_C0 * sh_coef(sh_base + 0u);\n\n    if sh_deg > 0u {\n        let x = dir.x;\n        let y = dir.y;\n        let z = dir.z;\n\n        result += SH_C1 * ( -y * sh_coef(sh_base + 1u)\n                            +z * sh_coef(sh_base + 2u)\n                            -x * sh_coef(sh_base + 3u) );\n\n        if sh_deg > 1u {\n            let xx = x * x;\n            let yy = y * y;\n            let zz = z * z;\n            let xy = x * y;\n            let yz = y * z;\n            let xz = x * z;\n\n            result += SH_C2[0] * xy * sh_coef(sh_base + 4u) +\n                      SH_C2[1] * yz * sh_coef(sh_base + 5u) +\n                      SH_C2[2] * (2.0 * zz - xx - yy) * sh_coef(sh_base + 6u) +\n                      SH_C2[3] * xz * sh_coef(sh_base + 7u) +\n                      SH_C2[4] * (xx - yy) * sh_coef(sh_base + 8u);\n\n            if sh_deg > 2u {\n                result += SH_C3[0] * y * (3.0 * xx - yy) * sh_coef(sh_base + 9u) +\n                          SH_C3[1] * xy * z * sh_coef(sh_base + 10u) +\n                          SH_C3[2] * y * (4.0 * zz - xx - yy) * sh_coef(sh_base + 11u) +\n                          SH_C3[3] * z * (2.0 * zz - 3.0 * xx - 3.0 * yy) * sh_coef(sh_base + 12u) +\n                          SH_C3[4] * x * (4.0 * zz - xx - yy) * sh_coef(sh_base + 13u) +\n                          SH_C3[5] * z * (xx - yy) * sh_coef(sh_base + 14u) +\n                          SH_C3[6] * x * (xx - 3.0 * yy) * sh_coef(sh_base + 15u);\n            }\n        }\n    }\n\n    return max(result + 0.5, vec3(0.0));\n}\n\n@compute @workgroup_size(WG_SIZE)\nfn preprocess(@builtin(global_invocation_id) gid: vec3<u32>) {\n    if gid.x >= sort_infos.keys_size { return; }\n\n    let solver = sh_solvers[gid.x];\n    let dir = vec3<f16>(solver.dir_xy, solver.dir_z_opacity.x);\n    let opacity_val = f32(solver.dir_z_opacity.y);\n\n    let rgb = evaluate_sh(dir, solver.idx, render_settings.max_sh_deg, render_settings.cur_sh_deg);\n    let rgb_f32 = vec3<f32>(rgb);\n    colors[gid.x] = vec2<u32>(\n        pack2x16float(rgb_f32.rg),\n        pack2x16float(vec2<f32>(rgb_f32.b, opacity_val)),\n    );\n}\n";

// vendor/websplatter/src/shaders/preprocess_f16_plyf32.wgsl
var preprocess_f16_plyf32_default = "enable f16;\n\nstruct GeneralInfo{\n  keys_size : u32, dispatch_x: u32, dispatch_y: u32, dispatch_z: u32,\n  l0_x : u32, l0_y : u32, l0_z : u32, l0_t : u32,\n  l1_x : u32, l1_y : u32, l1_z : u32, l1_t : u32,\n};\n\nconst WG_SIZE = 256u;\n\nconst PI: f32 = acos(-1.0);\n\nconst SH_C0: f16 = f16(sqrt(1.0 / (4.0 * PI)));\n\nconst SH_C1: f16 = f16(sqrt(3.0 / (4.0 * PI)));\n\nconst SH_C2: array<f16, 5> = array<f16, 5>(\n    f16(sqrt(15.0 / (4.0 * PI))),\n    f16(-sqrt(15.0 / (4.0 * PI))),\n    f16(sqrt(5.0 / (16.0 * PI))),\n    f16(-sqrt(15.0 / (4.0 * PI))),\n    f16(sqrt(15.0 / (16.0 * PI)))\n);\n\nconst SH_C3: array<f16, 7> = array<f16, 7>(\n    f16(-sqrt(35.0 / (32.0 * PI))),\n    f16(sqrt(105.0 / (4.0 * PI))),\n    f16(-sqrt(21.0 / (32.0 * PI))),\n    f16(sqrt(7.0 / (16.0 * PI))),\n    f16(-sqrt(21.0 / (32.0 * PI))),\n    f16(sqrt(105.0 / (16.0 * PI))),\n    f16(-sqrt(35.0 / (32.0 * PI)))\n);\n\nstruct CameraUniforms {\n    view: mat4x4<f32>,\n    view_inv: mat4x4<f32>,\n    proj: mat4x4<f32>,\n    proj_inv: mat4x4<f32>,\n    viewport: vec2<f32>,\n    focal: vec2<f32>\n};\n\nstruct SHSolver {\n    dir_xy: vec2<f16>,\n    dir_z_opacity: vec2<f16>,\n    idx: u32,\n};\n\nstruct RenderSettings {\n    canvas_size: vec2<u32>,\n    max_sh_deg: u32,\n    cur_sh_deg: u32,\n    gaussian_scaling: f32,\n    kernel_size: f32,\n    mip_spatting: u32,\n    walltime: f32,\n};\n\n@group(0) @binding(0) var<uniform> camera: CameraUniforms;\n@group(0) @binding(1) var<uniform> render_settings: RenderSettings;\n\n@group(1) @binding(0) var<storage, read> sort_infos: GeneralInfo;\n@group(1) @binding(1) var<storage, read> sh_coefs : array<f32>;\n@group(1) @binding(2) var<storage, read> sh_solvers : array<SHSolver>;\n@group(1) @binding(3) var<storage, read_write> colors : array<vec4<f32>>;\n\nfn sh_coef(idx: u32) -> vec3<f16> {\n    return vec3<f16>(f16(sh_coefs[idx * 3u + 0u]), f16(sh_coefs[idx * 3u + 1u]), f16(sh_coefs[idx * 3u + 2u]));\n}\n\nfn evaluate_sh(dir: vec3<f16>, v_idx: u32, max_sh_deg: u32, sh_deg: u32) -> vec3<f16> {\n    let sh_base = (max_sh_deg + 1u) * (max_sh_deg + 1u) * v_idx;\n\n    var result = SH_C0 * sh_coef(sh_base + 0u);\n\n    if sh_deg > 0u {\n        let x = dir.x;\n        let y = dir.y;\n        let z = dir.z;\n\n        result += SH_C1 * ( -y * sh_coef(sh_base + 1u)\n                            +z * sh_coef(sh_base + 2u)\n                            -x * sh_coef(sh_base + 3u) );\n\n        if sh_deg > 1u {\n            let xx = x * x;\n            let yy = y * y;\n            let zz = z * z;\n            let xy = x * y;\n            let yz = y * z;\n            let xz = x * z;\n\n            result += SH_C2[0] * xy * sh_coef(sh_base + 4u) +\n                      SH_C2[1] * yz * sh_coef(sh_base + 5u) +\n                      SH_C2[2] * (2.0 * zz - xx - yy) * sh_coef(sh_base + 6u) +\n                      SH_C2[3] * xz * sh_coef(sh_base + 7u) +\n                      SH_C2[4] * (xx - yy) * sh_coef(sh_base + 8u);\n\n            if sh_deg > 2u {\n                result += SH_C3[0] * y * (3.0 * xx - yy) * sh_coef(sh_base + 9u) +\n                          SH_C3[1] * xy * z * sh_coef(sh_base + 10u) +\n                          SH_C3[2] * y * (4.0 * zz - xx - yy) * sh_coef(sh_base + 11u) +\n                          SH_C3[3] * z * (2.0 * zz - 3.0 * xx - 3.0 * yy) * sh_coef(sh_base + 12u) +\n                          SH_C3[4] * x * (4.0 * zz - xx - yy) * sh_coef(sh_base + 13u) +\n                          SH_C3[5] * z * (xx - yy) * sh_coef(sh_base + 14u) +\n                          SH_C3[6] * x * (xx - 3.0 * yy) * sh_coef(sh_base + 15u);\n            }\n        }\n    }\n\n    return max(result + 0.5, vec3(0.0));\n}\n\n@compute @workgroup_size(WG_SIZE)\nfn preprocess(@builtin(global_invocation_id) gid: vec3<u32>) {\n    if gid.x >= sort_infos.keys_size { return; }\n\n    let solver = sh_solvers[gid.x];\n    let dir = vec3<f16>(solver.dir_xy, solver.dir_z_opacity.x);\n    let opacity_val = f32(solver.dir_z_opacity.y);\n\n    let rgb = evaluate_sh(dir, solver.idx, render_settings.max_sh_deg, render_settings.cur_sh_deg);\n    let rgb_f32 = vec3<f32>(rgb);\n    colors[gid.x] = vec4<f32>(rgb_f32.r, rgb_f32.g, rgb_f32.b, opacity_val);\n}\n";

// vendor/websplatter/src/shaders/preprocess_f32.wgsl
var preprocess_f32_default = "struct GeneralInfo{\n  keys_size : u32, dispatch_x: u32, dispatch_y: u32, dispatch_z: u32,\n  l0_x : u32, l0_y : u32, l0_z : u32, l0_t : u32,\n  l1_x : u32, l1_y : u32, l1_z : u32, l1_t : u32,\n};\n\nconst WG_SIZE = 256u;\n\nconst PI: f32 = acos(-1.0);\n\nconst SH_C0: f32 = sqrt(1.0 / (4.0 * PI));\n\nconst SH_C1: f32 = sqrt(3.0 / (4.0 * PI));\n\nconst SH_C2: array<f32, 5> = array<f32, 5>(\n    sqrt(15.0 / (4.0 * PI)),\n    -sqrt(15.0 / (4.0 * PI)),\n    sqrt(5.0 / (16.0 * PI)),\n    -sqrt(15.0 / (4.0 * PI)),\n    sqrt(15.0 / (16.0 * PI))\n);\n\nconst SH_C3: array<f32, 7> = array<f32, 7>(\n    -sqrt(35.0 / (32.0 * PI)),\n    sqrt(105.0 / (4.0 * PI)),\n    -sqrt(21.0 / (32.0 * PI)),\n    sqrt(7.0 / (16.0 * PI)),\n    -sqrt(21.0 / (32.0 * PI)),\n    sqrt(105.0 / (16.0 * PI)),\n    -sqrt(35.0 / (32.0 * PI))\n);\n\nstruct CameraUniforms {\n    view: mat4x4<f32>,\n    view_inv: mat4x4<f32>,\n    proj: mat4x4<f32>,\n    proj_inv: mat4x4<f32>,\n    viewport: vec2<f32>,\n    focal: vec2<f32>\n};\n\nstruct SHSolver {\n    dir_xy: u32,\n    dir_z_opacity: u32,\n    idx: u32,\n}\n\nstruct RenderSettings {\n    canvas_size: vec2<u32>,\n    max_sh_deg: u32,\n    cur_sh_deg: u32,\n    gaussian_scaling: f32,\n    kernel_size: f32,\n    mip_spatting: u32,\n    walltime: f32,\n};\n\n@group(0) @binding(0) var<uniform> camera: CameraUniforms;\n@group(0) @binding(1) var<uniform> render_settings: RenderSettings;\n\n@group(1) @binding(0) var<storage, read> sort_infos: GeneralInfo;\n@group(1) @binding(1) var<storage, read> sh_coefs : array<u32>;\n@group(1) @binding(2) var<storage, read> sh_solvers : array<SHSolver>;\n@group(1) @binding(3) var<storage, read_write> colors : array<vec2<u32>>;\n\nfn sh_coef(idx: u32) -> vec3<f32> {\n    let ri = idx * 3u + 0u;\n    let gi = idx * 3u + 1u;\n    let bi = idx * 3u + 2u;\n    let r = unpack2x16float(sh_coefs[ri >> 1])[ri & 1u];\n    let g = unpack2x16float(sh_coefs[gi >> 1])[gi & 1u];\n    let b = unpack2x16float(sh_coefs[bi >> 1])[bi & 1u];\n    return vec3<f32>(r, g, b);\n}\n\nfn evaluate_sh(dir: vec3<f32>, v_idx: u32, max_sh_deg: u32, sh_deg: u32) -> vec3<f32> {\n    let sh_base = (max_sh_deg + 1u) * (max_sh_deg + 1u) * v_idx;\n\n    var result = SH_C0 * sh_coef(sh_base + 0u);\n\n    if sh_deg > 0u {\n        let x = dir.x;\n        let y = dir.y;\n        let z = dir.z;\n\n        result += SH_C1 * ( -y * sh_coef(sh_base + 1u)\n                            +z * sh_coef(sh_base + 2u)\n                            -x * sh_coef(sh_base + 3u) );\n\n        if sh_deg > 1u {\n            let xx = x * x;\n            let yy = y * y;\n            let zz = z * z;\n            let xy = x * y;\n            let yz = y * z;\n            let xz = x * z;\n\n            result += SH_C2[0] * xy * sh_coef(sh_base + 4u) +\n                      SH_C2[1] * yz * sh_coef(sh_base + 5u) +\n                      SH_C2[2] * (2.0 * zz - xx - yy) * sh_coef(sh_base + 6u) +\n                      SH_C2[3] * xz * sh_coef(sh_base + 7u) +\n                      SH_C2[4] * (xx - yy) * sh_coef(sh_base + 8u);\n\n            if sh_deg > 2u {\n                result += SH_C3[0] * y * (3.0 * xx - yy) * sh_coef(sh_base + 9u) +\n                          SH_C3[1] * xy * z * sh_coef(sh_base + 10u) +\n                          SH_C3[2] * y * (4.0 * zz - xx - yy) * sh_coef(sh_base + 11u) +\n                          SH_C3[3] * z * (2.0 * zz - 3.0 * xx - 3.0 * yy) * sh_coef(sh_base + 12u) +\n                          SH_C3[4] * x * (4.0 * zz - xx - yy) * sh_coef(sh_base + 13u) +\n                          SH_C3[5] * z * (xx - yy) * sh_coef(sh_base + 14u) +\n                          SH_C3[6] * x * (xx - 3.0 * yy) * sh_coef(sh_base + 15u);\n            }\n        }\n    }\n\n    return max(result + 0.5, vec3(0.0));\n}\n\n@compute @workgroup_size(WG_SIZE)\nfn preprocess(@builtin(global_invocation_id) gid: vec3<u32>) {\n    if gid.x >= sort_infos.keys_size { return; }\n\n    let solver = sh_solvers[gid.x];\n    let dir_opacity = vec4<f32>(unpack2x16float(solver.dir_xy), unpack2x16float(solver.dir_z_opacity));\n\n    let rgb_f32 = evaluate_sh(dir_opacity.xyz, solver.idx, render_settings.max_sh_deg, render_settings.cur_sh_deg);\n    let opacity_val = dir_opacity.w;\n    colors[gid.x] = vec2<u32>(\n        pack2x16float(rgb_f32.rg),\n        pack2x16float(vec2<f32>(rgb_f32.b, opacity_val)),\n    );\n}\n";

// vendor/websplatter/src/shaders/preprocess_f32_plyf32.wgsl
var preprocess_f32_plyf32_default = "struct GeneralInfo{\n  keys_size : u32, dispatch_x: u32, dispatch_y: u32, dispatch_z: u32,\n  l0_x : u32, l0_y : u32, l0_z : u32, l0_t : u32,\n  l1_x : u32, l1_y : u32, l1_z : u32, l1_t : u32,\n};\n\nconst WG_SIZE = 256u;\n\nconst PI: f32 = acos(-1.0);\n\nconst SH_C0: f32 = sqrt(1.0 / (4.0 * PI));\n\nconst SH_C1: f32 = sqrt(3.0 / (4.0 * PI));\n\nconst SH_C2: array<f32, 5> = array<f32, 5>(\n    sqrt(15.0 / (4.0 * PI)),\n    -sqrt(15.0 / (4.0 * PI)),\n    sqrt(5.0 / (16.0 * PI)),\n    -sqrt(15.0 / (4.0 * PI)),\n    sqrt(15.0 / (16.0 * PI))\n);\n\nconst SH_C3: array<f32, 7> = array<f32, 7>(\n    -sqrt(35.0 / (32.0 * PI)),\n    sqrt(105.0 / (4.0 * PI)),\n    -sqrt(21.0 / (32.0 * PI)),\n    sqrt(7.0 / (16.0 * PI)),\n    -sqrt(21.0 / (32.0 * PI)),\n    sqrt(105.0 / (16.0 * PI)),\n    -sqrt(35.0 / (32.0 * PI))\n);\n\nstruct CameraUniforms {\n    view: mat4x4<f32>,\n    view_inv: mat4x4<f32>,\n    proj: mat4x4<f32>,\n    proj_inv: mat4x4<f32>,\n    viewport: vec2<f32>,\n    focal: vec2<f32>\n};\n\nstruct SHSolver {\n    dir_xy: u32,\n    dir_z_opacity: u32,\n    idx: u32,\n}\n\nstruct RenderSettings {\n    canvas_size: vec2<u32>,\n    max_sh_deg: u32,\n    cur_sh_deg: u32,\n    gaussian_scaling: f32,\n    kernel_size: f32,\n    mip_spatting: u32,\n    walltime: f32,\n};\n\n@group(0) @binding(0) var<uniform> camera: CameraUniforms;\n@group(0) @binding(1) var<uniform> render_settings: RenderSettings;\n\n@group(1) @binding(0) var<storage, read> sort_infos: GeneralInfo;\n@group(1) @binding(1) var<storage, read> sh_coefs : array<f32>;\n@group(1) @binding(2) var<storage, read> sh_solvers : array<SHSolver>;\n@group(1) @binding(3) var<storage, read_write> colors : array<vec4<f32>>;\n\nfn sh_coef(idx: u32) -> vec3<f32> {\n    return vec3<f32>(sh_coefs[idx * 3u + 0u], sh_coefs[idx * 3u + 1u], sh_coefs[idx * 3u + 2u]);\n}\n\nfn evaluate_sh(dir: vec3<f32>, v_idx: u32, max_sh_deg: u32, sh_deg: u32) -> vec3<f32> {\n    let sh_base = (max_sh_deg + 1u) * (max_sh_deg + 1u) * v_idx;\n\n    var result = SH_C0 * sh_coef(sh_base + 0u);\n\n    if sh_deg > 0u {\n        let x = dir.x;\n        let y = dir.y;\n        let z = dir.z;\n\n        result += SH_C1 * ( -y * sh_coef(sh_base + 1u)\n                            +z * sh_coef(sh_base + 2u)\n                            -x * sh_coef(sh_base + 3u) );\n\n        if sh_deg > 1u {\n            let xx = x * x;\n            let yy = y * y;\n            let zz = z * z;\n            let xy = x * y;\n            let yz = y * z;\n            let xz = x * z;\n\n            result += SH_C2[0] * xy * sh_coef(sh_base + 4u) +\n                      SH_C2[1] * yz * sh_coef(sh_base + 5u) +\n                      SH_C2[2] * (2.0 * zz - xx - yy) * sh_coef(sh_base + 6u) +\n                      SH_C2[3] * xz * sh_coef(sh_base + 7u) +\n                      SH_C2[4] * (xx - yy) * sh_coef(sh_base + 8u);\n\n            if sh_deg > 2u {\n                result += SH_C3[0] * y * (3.0 * xx - yy) * sh_coef(sh_base + 9u) +\n                          SH_C3[1] * xy * z * sh_coef(sh_base + 10u) +\n                          SH_C3[2] * y * (4.0 * zz - xx - yy) * sh_coef(sh_base + 11u) +\n                          SH_C3[3] * z * (2.0 * zz - 3.0 * xx - 3.0 * yy) * sh_coef(sh_base + 12u) +\n                          SH_C3[4] * x * (4.0 * zz - xx - yy) * sh_coef(sh_base + 13u) +\n                          SH_C3[5] * z * (xx - yy) * sh_coef(sh_base + 14u) +\n                          SH_C3[6] * x * (xx - 3.0 * yy) * sh_coef(sh_base + 15u);\n            }\n        }\n    }\n\n    return max(result + 0.5, vec3(0.0));\n}\n\n@compute @workgroup_size(WG_SIZE)\nfn preprocess(@builtin(global_invocation_id) gid: vec3<u32>) {\n    if gid.x >= sort_infos.keys_size { return; }\n\n    let solver = sh_solvers[gid.x];\n    let dir_opacity = vec4<f32>(unpack2x16float(solver.dir_xy), unpack2x16float(solver.dir_z_opacity));\n\n    let rgb_f32 = evaluate_sh(dir_opacity.xyz, solver.idx, render_settings.max_sh_deg, render_settings.cur_sh_deg);\n    let opacity_val = dir_opacity.w;\n    colors[gid.x] = vec4<f32>(rgb_f32.r, rgb_f32.g, rgb_f32.b, opacity_val);\n}\n";

// vendor/websplatter/src/shaders/gaussian_render_conic.wgsl
var gaussian_render_conic_default = "// Oriented-quad Gaussian render shader \u2014 ply_precision=f16 variant\n\nconst CUTOFF = log(255.);\n\noverride DISABLE_OPACITY_RADIUS: u32 = 0u;\n\nstruct VertexOutput {\n    @builtin(position) position: vec4<f32>,\n    @location(0) @interpolate(flat) color: vec4<f32>,\n    @location(1) uv: vec2<f32>,\n};\n\nstruct Splat {\n    v_0: u32,\n    v_1: u32,\n    center_ndc: u32,\n};\n\n@group(0) @binding(0) var<storage, read> points_2d : array<Splat>;\n@group(0) @binding(1) var<storage, read> color : array<vec2<u32>>;\n@group(0) @binding(2) var<storage, read> indices : array<u32>;\n\n@vertex\nfn vs_main(\n    @builtin(vertex_index) vid: u32,\n    @builtin(instance_index) iid: u32\n) -> VertexOutput {\n    let idx = indices[iid];\n    let vertex = points_2d[idx];\n\n    let rg = unpack2x16float(color[idx].x);\n    let ba = unpack2x16float(color[idx].y);\n    let rgba = vec4<f32>(rg, ba);\n\n    let v0 = unpack2x16float(vertex.v_0);\n    let v1 = unpack2x16float(vertex.v_1);\n    let center = unpack2x16float(vertex.center_ndc);\n\n    // Opacity-adaptive radius_scale (disabled \u2192 fixed worst-case radius)\n    var rs: f32;\n    if DISABLE_OPACITY_RADIUS == 1u {\n        rs = sqrt(CUTOFF);\n    } else {\n        rs = sqrt(log(max(1.0, 255.0 * rgba.a)));\n    }\n\n    let corner = vec2<f32>(f32((vid & 1u) == 0u) * 2.0 - 1.0, f32(vid < 2u) * 2.0 - 1.0);\n    let ndc = center + v0 * corner.x * rs + v1 * corner.y * rs;\n\n    return VertexOutput(\n        vec4<f32>(ndc, 0.0, 1.0),\n        rgba,\n        corner,\n    );\n}\n\n@fragment\nfn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {\n    let sigma_sq = dot(in.uv, in.uv);\n    let opacity = in.color.a;\n\n    var cutoff_val: f32;\n    if DISABLE_OPACITY_RADIUS == 1u {\n        cutoff_val = CUTOFF;\n    } else {\n        cutoff_val = log(max(1.0, 255.0 * opacity));\n    }\n    let alpha = min(0.99, opacity * exp(-cutoff_val * sigma_sq));\n\n    if alpha < 1.0 / 255.0 {\n        return vec4<f32>(0.0);\n    }\n    return vec4<f32>(in.color.rgb, 1.0) * alpha;\n}\n";

// vendor/websplatter/src/shaders/gaussian_render_conic_plyf32.wgsl
var gaussian_render_conic_plyf32_default = "// Oriented-quad Gaussian render shader \u2014 ply_precision=f32 variant\n\nconst CUTOFF = log(255.);\n\noverride DISABLE_OPACITY_RADIUS: u32 = 0u;\n\nstruct VertexOutput {\n    @builtin(position) position: vec4<f32>,\n    @location(0) @interpolate(flat) color: vec4<f32>,\n    @location(1) uv: vec2<f32>,\n};\n\nstruct Splat {\n    v_0_x: f32, v_0_y: f32,\n    v_1_x: f32, v_1_y: f32,\n    center_ndc_x: f32, center_ndc_y: f32,\n};\n\n@group(0) @binding(0) var<storage, read> points_2d : array<Splat>;\n@group(0) @binding(1) var<storage, read> color : array<vec4<f32>>;\n@group(0) @binding(2) var<storage, read> indices : array<u32>;\n\n@vertex\nfn vs_main(\n    @builtin(vertex_index) vid: u32,\n    @builtin(instance_index) iid: u32\n) -> VertexOutput {\n    let idx = indices[iid];\n    let vertex = points_2d[idx];\n\n    let rgba = color[idx];\n    let v0 = vec2<f32>(vertex.v_0_x, vertex.v_0_y);\n    let v1 = vec2<f32>(vertex.v_1_x, vertex.v_1_y);\n    let center = vec2<f32>(vertex.center_ndc_x, vertex.center_ndc_y);\n\n    // Opacity-adaptive radius_scale (disabled \u2192 fixed worst-case radius)\n    var rs: f32;\n    if DISABLE_OPACITY_RADIUS == 1u {\n        rs = sqrt(CUTOFF);\n    } else {\n        rs = sqrt(log(max(1.0, 255.0 * rgba.a)));\n    }\n\n    let corner = vec2<f32>(f32((vid & 1u) == 0u) * 2.0 - 1.0, f32(vid < 2u) * 2.0 - 1.0);\n    let ndc = center + v0 * corner.x * rs + v1 * corner.y * rs;\n\n    return VertexOutput(\n        vec4<f32>(ndc, 0.0, 1.0),\n        rgba,\n        corner,\n    );\n}\n\n@fragment\nfn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {\n    let sigma_sq = dot(in.uv, in.uv);\n    let opacity = in.color.a;\n\n    var cutoff_val: f32;\n    if DISABLE_OPACITY_RADIUS == 1u {\n        cutoff_val = CUTOFF;\n    } else {\n        cutoff_val = log(max(1.0, 255.0 * opacity));\n    }\n    let alpha = min(0.99, opacity * exp(-cutoff_val * sigma_sq));\n\n    if alpha < 1.0 / 255.0 {\n        return vec4<f32>(0.0);\n    }\n    return vec4<f32>(in.color.rgb, 1.0) * alpha;\n}\n";

// vendor/websplatter/src/shaders/gaussian_calculate_indirect_dispatch.wgsl
var gaussian_calculate_indirect_dispatch_default = "const WG_SIZE = 256u;\nconst TILE_SIZE = 256u;\noverride RS_RADIX_LOG2 = 8u;  // 2 bit radices\noverride RS_RADIX_SIZE = 1u << RS_RADIX_LOG2;    // 4 entries into the radix table\n\nstruct GeneralInfo{\n  keys_size : u32,  dispatch_x: u32, dispatch_y: u32, dispatch_z: u32,\n  l0_x : u32, l0_y : u32, l0_z : u32, l0_t : u32, // t0\n  l1_x : u32, l1_y : u32, l1_z : u32, l1_t : u32, // t1\n};\n\nstruct DrawIndirect {\n    vertex_count: u32,\n    instance_count: u32,\n    first_vertex: u32,\n    first_instance: u32,\n}\n\n@group(0) @binding(0) var<storage, read_write> infos: GeneralInfo;\n@group(0) @binding(1) var<storage, read_write> draw_indirect: DrawIndirect;\n\n@compute @workgroup_size(1)\nfn write_dispatch_triples(\n    @builtin(workgroup_id)        wid: vec3<u32>,\n    @builtin(local_invocation_id) lid: vec3<u32>\n) {\n    if wid.x == 0u && lid.x == 0u {\n        draw_indirect.instance_count = infos.keys_size;\n        // Histogram/Scatter dispatch X (elements divided by WG_SIZE)\n        infos.dispatch_x = (infos.keys_size + WG_SIZE - 1u) / WG_SIZE;\n        infos.dispatch_y = 1u;\n        infos.dispatch_z = 1u;\n\n        // Two-level tile counts\n        let t0 = (infos.dispatch_x + TILE_SIZE - 1u) / TILE_SIZE;\n        let t1 = (t0 + TILE_SIZE - 1u) / TILE_SIZE;\n\n        // Triples for L0/L1 plus t0/t1\n        infos.l0_x = t0; infos.l0_y = RS_RADIX_SIZE; infos.l0_z = 1u; infos.l0_t = t0;\n        infos.l1_x = t1; infos.l1_y = RS_RADIX_SIZE; infos.l1_z = 1u; infos.l1_t = t1;\n    }\n}";

// vendor/websplatter/src/shaders/gaussian_cull.wgsl
var gaussian_cull_default = "// Culling & index compaction pass \u2014 ply_precision=f16 variant\n\nstruct GeneralInfo{\n  keys_size : atomic<u32>, dispatch_x: u32, dispatch_y: u32, dispatch_z: u32,\n  l0_x : u32, l0_y : u32, l0_z : u32, l0_t : u32,\n  l1_x : u32, l1_y : u32, l1_z : u32, l1_t : u32,\n};\n\nconst WG_SIZE = 256u;\nconst CUTOFF = log(255.);\n\noverride DISABLE_AABB_CULL: u32 = 0u;\noverride DISABLE_OPACITY_RADIUS: u32 = 0u;\n\nstruct CameraUniforms {\n    view: mat4x4<f32>,\n    view_inv: mat4x4<f32>,\n    proj: mat4x4<f32>,\n    proj_inv: mat4x4<f32>,\n    viewport: vec2<f32>,\n    focal: vec2<f32>\n};\n\nstruct Gaussian {\n    xy: u32,\n    zw: u32,\n    cov01: u32,\n    cov23: u32,\n    cov45: u32,\n};\n\nstruct Splat {\n    v_0: u32,        // pack2x16float \u2014 eigenvector 0 in NDC (unbaked)\n    v_1: u32,        // pack2x16float \u2014 eigenvector 1 in NDC (unbaked)\n    center_ndc: u32,  // pack2x16float \u2014 center in NDC\n};\n\nstruct RenderSettings {\n    canvas_size: vec2<u32>,\n    max_sh_deg: u32,\n    cur_sh_deg: u32,\n    gaussian_scaling: f32,\n    kernel_size: f32,\n    mip_spatting: u32,\n    walltime: f32,\n}\n\nstruct SHSolver {\n    dir_xy: u32,\n    dir_z_opacity: u32,\n    idx: u32,\n}\n\n@group(0) @binding(0) var<uniform> camera: CameraUniforms;\n@group(0) @binding(1) var<uniform> render_settings: RenderSettings;\n\n@group(1) @binding(0) var<storage, read> gaussians : array<Gaussian>;\n@group(1) @binding(1) var<storage, read_write> points_2d : array<Splat>;\n\n@group(2) @binding(0) var<storage, read_write> sort_infos: GeneralInfo;\n@group(2) @binding(1) var<storage, read_write> sort_depths : array<u32>;\n@group(2) @binding(2) var<storage, read_write> sort_indices : array<u32>;\n@group(2) @binding(3) var<storage, read_write> sh_solvers : array<SHSolver>;\n\nvar<workgroup> scan0: array<u32, WG_SIZE>;\nvar<workgroup> scan1: array<u32, WG_SIZE>;\nvar<workgroup> group_base: u32;\n\n@compute @workgroup_size(WG_SIZE)\nfn preprocess_cull(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {\n    var alive = 0u;\n    var depth: f32;\n    var v_0: vec2<f32>;\n    var v_1: vec2<f32>;\n    var v_center: vec2<f32>;\n    var opacity: f32;\n    var dir: vec3<f32>;\n\n    let idx = gid.x;\n    if idx < arrayLength(&gaussians) {\n        let vertex = gaussians[idx];\n        let xyzw = vec4<f32>(unpack2x16float(vertex.xy), unpack2x16float(vertex.zw));\n        let xyz = xyzw.xyz;\n        opacity = xyzw.w;\n\n        var camspace = camera.view * vec4<f32>(xyz, 1.0);\n        let pos2d = camera.proj * camspace;\n\n        let z = pos2d.z / pos2d.w;\n        if camspace.z > 0.2 && z > 0.0 && z < 1.0 {\n            let focal: vec2<f32> = camera.focal;\n            let viewport: vec2<f32> = camera.viewport;\n            let scaling: f32 = render_settings.gaussian_scaling;\n\n            let cov01 = unpack2x16float(vertex.cov01);\n            let cov23 = unpack2x16float(vertex.cov23);\n            let cov45 = unpack2x16float(vertex.cov45);\n            let Vrk = mat3x3<f32>(\n                cov01.x, cov01.y, cov23.x,\n                cov01.y, cov23.y, cov45.x,\n                cov23.x, cov45.x, cov45.y,\n            ) * scaling * scaling;\n\n            var t = camspace.xyz;\n            let tan_fovx = viewport.x / (2.0 * focal.x);\n            let tan_fovy = viewport.y / (2.0 * focal.y);\n            let limx = 1.3 * tan_fovx;\n            let limy = 1.3 * tan_fovy;\n            t.x = clamp(t.x / t.z, -limx, limx) * t.z;\n            t.y = clamp(t.y / t.z, -limy, limy) * t.z;\n\n            let J: mat3x3<f32> = mat3x3<f32>(\n                focal.x / t.z,\n                0.0,\n                -(focal.x * t.x) / (t.z * t.z),\n                0.0,\n                focal.y / t.z,\n                -(focal.y * t.y) / (t.z * t.z),\n                0.0,\n                0.0,\n                0.0\n            );\n\n            let W = transpose(mat3x3<f32>(camera.view[0].xyz, camera.view[1].xyz, camera.view[2].xyz));\n            let T = W * J;\n            let cov = transpose(T) * Vrk * T;\n\n            let kernel_size: f32 = render_settings.kernel_size;\n            if bool(render_settings.mip_spatting) {\n                let det_0: f32 = max(1e-6, cov[0][0] * cov[1][1] - cov[0][1] * cov[0][1]);\n                let det_1: f32 = max(1e-6, (cov[0][0] + kernel_size) * (cov[1][1] + kernel_size) - cov[0][1] * cov[0][1]);\n                var coef: f32 = sqrt(det_0 / (det_1 + 1e-6) + 1e-6);\n                if (det_0 <= 1e-6 || det_1 <= 1e-6) {\n                    coef = 0.0;\n                }\n                opacity *= coef;\n            }\n\n            if opacity > 1.0 / 255.0 {\n                opacity = min(opacity, 1.0);\n\n                let diagonal1 = cov[0][0] + kernel_size;\n                let offDiagonal = cov[0][1];\n                let diagonal2 = cov[1][1] + kernel_size;\n\n                let mid = 0.5 * (diagonal1 + diagonal2);\n                let eigRadius = length(vec2<f32>((diagonal1 - diagonal2) / 2.0, offDiagonal));\n                let lambda1 = mid + eigRadius;\n                let lambda2 = max(mid - eigRadius, 0.1);\n\n                // Guard against degenerate isotropic case\n                var diagonalVector: vec2<f32>;\n                if eigRadius < 1e-6 {\n                    diagonalVector = vec2<f32>(1.0, 0.0);\n                } else {\n                    diagonalVector = normalize(vec2<f32>(offDiagonal, lambda1 - diagonal1));\n                }\n\n                // NDC \u2194 pixel: \u0394ndc = \u0394pixel * (2/W, -2/H) because NDC Y-up, pixel Y-down\n                let pixel_to_ndc = vec2<f32>(2.0, -2.0) / viewport;\n                v_0 = sqrt(2.0 * lambda1) * diagonalVector * pixel_to_ndc;\n                v_1 = sqrt(2.0 * lambda2) * vec2<f32>(diagonalVector.y, -diagonalVector.x) * pixel_to_ndc;\n                v_center = pos2d.xy / pos2d.w;\n\n                var radius_scale: f32;\n                if DISABLE_OPACITY_RADIUS == 1u {\n                    radius_scale = sqrt(CUTOFF);\n                } else {\n                    radius_scale = sqrt(log(255.0 * opacity));\n                }\n\n                let camera_pos = vec3<f32>(camera.view_inv[3].xyz);\n                dir = normalize(xyz - camera_pos);\n\n                let zfar = -camera.proj[3][2] / (camera.proj[2][2] - 1.0);\n                depth = zfar - pos2d.z;\n\n                let half_extent = (abs(v_0) + abs(v_1)) * radius_scale;\n                if DISABLE_AABB_CULL == 1u {\n                    alive = 1u;\n                } else {\n                    let min_pos = v_center - half_extent;\n                    let max_pos = v_center + half_extent;\n                    if max_pos.x > -1.0 && max_pos.y > -1.0 && min_pos.x < 1.0 && min_pos.y < 1.0 {\n                        alive = 1u;\n                    }\n                }\n            }\n        }\n    }\n    scan0[lid.x] = alive;\n\n    workgroupBarrier();\n\n    if (lid.x >= 1u) { scan1[lid.x] = scan0[lid.x] + scan0[lid.x - 1u]; } else { scan1[lid.x] = scan0[lid.x]; } workgroupBarrier();\n    if (lid.x >= 2u) { scan0[lid.x] = scan1[lid.x] + scan1[lid.x - 2u]; } else { scan0[lid.x] = scan1[lid.x]; } workgroupBarrier();\n    if (lid.x >= 4u) { scan1[lid.x] = scan0[lid.x] + scan0[lid.x - 4u]; } else { scan1[lid.x] = scan0[lid.x]; } workgroupBarrier();\n    if (lid.x >= 8u) { scan0[lid.x] = scan1[lid.x] + scan1[lid.x - 8u]; } else { scan0[lid.x] = scan1[lid.x]; } workgroupBarrier();\n    if (lid.x >= 16u) { scan1[lid.x] = scan0[lid.x] + scan0[lid.x - 16u]; } else { scan1[lid.x] = scan0[lid.x]; } workgroupBarrier();\n    if (lid.x >= 32u) { scan0[lid.x] = scan1[lid.x] + scan1[lid.x - 32u]; } else { scan0[lid.x] = scan1[lid.x]; } workgroupBarrier();\n    if (lid.x >= 64u) { scan1[lid.x] = scan0[lid.x] + scan0[lid.x - 64u]; } else { scan1[lid.x] = scan0[lid.x]; } workgroupBarrier();\n    if (lid.x >= 128u) { scan0[lid.x] = scan1[lid.x] + scan1[lid.x - 128u]; } else { scan0[lid.x] = scan1[lid.x]; } workgroupBarrier();\n\n    if (lid.x == 0u) {\n        let group_cnt  = scan0[WG_SIZE - 1u];\n        if (group_cnt != 0u) {\n            group_base = atomicAdd(&sort_infos.keys_size, group_cnt);\n        }\n    }\n    workgroupBarrier();\n\n    if (alive == 1u) {\n        let store_idx = group_base + scan0[lid.x] - 1u;\n        sh_solvers[store_idx] = SHSolver(\n            pack2x16float(dir.xy),\n            pack2x16float(vec2<f32>(dir.z, opacity)),\n            idx,\n        );\n        points_2d[store_idx] = Splat(\n            pack2x16float(v_0),\n            pack2x16float(v_1),\n            pack2x16float(v_center),\n        );\n        sort_depths[store_idx] = bitcast<u32>(depth);\n        sort_indices[store_idx] = store_idx;\n    }\n}\n";

// vendor/websplatter/src/shaders/gaussian_cull_plyf32.wgsl
var gaussian_cull_plyf32_default = "// Culling & index compaction pass \u2014 ply_precision=f32 variant\n\nstruct GeneralInfo{\n  keys_size : atomic<u32>, dispatch_x: u32, dispatch_y: u32, dispatch_z: u32,\n  l0_x : u32, l0_y : u32, l0_z : u32, l0_t : u32,\n  l1_x : u32, l1_y : u32, l1_z : u32, l1_t : u32,\n};\n\nconst WG_SIZE = 256u;\nconst CUTOFF = log(255.);\n\noverride DISABLE_AABB_CULL: u32 = 0u;\noverride DISABLE_OPACITY_RADIUS: u32 = 0u;\n\nstruct CameraUniforms {\n    view: mat4x4<f32>,\n    view_inv: mat4x4<f32>,\n    proj: mat4x4<f32>,\n    proj_inv: mat4x4<f32>,\n    viewport: vec2<f32>,\n    focal: vec2<f32>\n};\n\nstruct Gaussian {\n    x: f32, y: f32, z: f32,\n    opacity: f32,\n    cov0: f32, cov1: f32, cov2: f32,\n    cov3: f32, cov4: f32, cov5: f32,\n};\n\nstruct Splat {\n    v_0_x: f32, v_0_y: f32,\n    v_1_x: f32, v_1_y: f32,\n    center_ndc_x: f32, center_ndc_y: f32,\n};\n\nstruct RenderSettings {\n    canvas_size: vec2<u32>,\n    max_sh_deg: u32,\n    cur_sh_deg: u32,\n    gaussian_scaling: f32,\n    kernel_size: f32,\n    mip_spatting: u32,\n    walltime: f32,\n}\n\nstruct SHSolver {\n    dir_xy: u32,\n    dir_z_opacity: u32,\n    idx: u32,\n}\n\n@group(0) @binding(0) var<uniform> camera: CameraUniforms;\n@group(0) @binding(1) var<uniform> render_settings: RenderSettings;\n\n@group(1) @binding(0) var<storage, read> gaussians : array<Gaussian>;\n@group(1) @binding(1) var<storage, read_write> points_2d : array<Splat>;\n\n@group(2) @binding(0) var<storage, read_write> sort_infos: GeneralInfo;\n@group(2) @binding(1) var<storage, read_write> sort_depths : array<u32>;\n@group(2) @binding(2) var<storage, read_write> sort_indices : array<u32>;\n@group(2) @binding(3) var<storage, read_write> sh_solvers : array<SHSolver>;\n\nvar<workgroup> scan0: array<u32, WG_SIZE>;\nvar<workgroup> scan1: array<u32, WG_SIZE>;\nvar<workgroup> group_base: u32;\n\n@compute @workgroup_size(WG_SIZE)\nfn preprocess_cull(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {\n    var alive = 0u;\n    var depth: f32;\n    var v_0: vec2<f32>;\n    var v_1: vec2<f32>;\n    var v_center: vec2<f32>;\n    var opacity: f32;\n    var dir: vec3<f32>;\n\n    let idx = gid.x;\n    if idx < arrayLength(&gaussians) {\n        let vertex = gaussians[idx];\n        let xyz = vec3<f32>(vertex.x, vertex.y, vertex.z);\n        opacity = vertex.opacity;\n\n        var camspace = camera.view * vec4<f32>(xyz, 1.0);\n        let pos2d = camera.proj * camspace;\n\n        let z = pos2d.z / pos2d.w;\n        if camspace.z > 0.2 && z > 0.0 && z < 1.0 {\n            let focal: vec2<f32> = camera.focal;\n            let viewport: vec2<f32> = camera.viewport;\n            let scaling: f32 = render_settings.gaussian_scaling;\n\n            let Vrk = mat3x3<f32>(\n                vertex.cov0, vertex.cov1, vertex.cov2,\n                vertex.cov1, vertex.cov3, vertex.cov4,\n                vertex.cov2, vertex.cov4, vertex.cov5,\n            ) * scaling * scaling;\n\n            var t = camspace.xyz;\n            let tan_fovx = viewport.x / (2.0 * focal.x);\n            let tan_fovy = viewport.y / (2.0 * focal.y);\n            let limx = 1.3 * tan_fovx;\n            let limy = 1.3 * tan_fovy;\n            t.x = clamp(t.x / t.z, -limx, limx) * t.z;\n            t.y = clamp(t.y / t.z, -limy, limy) * t.z;\n\n            let J: mat3x3<f32> = mat3x3<f32>(\n                focal.x / t.z,\n                0.0,\n                -(focal.x * t.x) / (t.z * t.z),\n                0.0,\n                focal.y / t.z,\n                -(focal.y * t.y) / (t.z * t.z),\n                0.0,\n                0.0,\n                0.0\n            );\n\n            let W = transpose(mat3x3<f32>(camera.view[0].xyz, camera.view[1].xyz, camera.view[2].xyz));\n            let T = W * J;\n            let cov = transpose(T) * Vrk * T;\n\n            let kernel_size: f32 = render_settings.kernel_size;\n            if bool(render_settings.mip_spatting) {\n                let det_0: f32 = max(1e-6, cov[0][0] * cov[1][1] - cov[0][1] * cov[0][1]);\n                let det_1: f32 = max(1e-6, (cov[0][0] + kernel_size) * (cov[1][1] + kernel_size) - cov[0][1] * cov[0][1]);\n                var coef: f32 = sqrt(det_0 / (det_1 + 1e-6) + 1e-6);\n                if (det_0 <= 1e-6 || det_1 <= 1e-6) {\n                    coef = 0.0;\n                }\n                opacity *= coef;\n            }\n\n            if opacity > 1.0 / 255.0 {\n                opacity = min(opacity, 1.0);\n\n                let diagonal1 = cov[0][0] + kernel_size;\n                let offDiagonal = cov[0][1];\n                let diagonal2 = cov[1][1] + kernel_size;\n\n                let mid = 0.5 * (diagonal1 + diagonal2);\n                let eigRadius = length(vec2<f32>((diagonal1 - diagonal2) / 2.0, offDiagonal));\n                let lambda1 = mid + eigRadius;\n                let lambda2 = max(mid - eigRadius, 0.1);\n\n                var diagonalVector: vec2<f32>;\n                if eigRadius < 1e-6 {\n                    diagonalVector = vec2<f32>(1.0, 0.0);\n                } else {\n                    diagonalVector = normalize(vec2<f32>(offDiagonal, lambda1 - diagonal1));\n                }\n\n                // NDC \u2194 pixel: \u0394ndc = \u0394pixel * (2/W, -2/H) because NDC Y-up, pixel Y-down\n                let pixel_to_ndc = vec2<f32>(2.0, -2.0) / viewport;\n                v_0 = sqrt(2.0 * lambda1) * diagonalVector * pixel_to_ndc;\n                v_1 = sqrt(2.0 * lambda2) * vec2<f32>(diagonalVector.y, -diagonalVector.x) * pixel_to_ndc;\n                v_center = pos2d.xy / pos2d.w;\n\n                var radius_scale: f32;\n                if DISABLE_OPACITY_RADIUS == 1u {\n                    radius_scale = sqrt(CUTOFF);\n                } else {\n                    radius_scale = sqrt(log(255.0 * opacity));\n                }\n\n                let camera_pos = vec3<f32>(camera.view_inv[3].xyz);\n                dir = normalize(xyz - camera_pos);\n\n                let zfar = -camera.proj[3][2] / (camera.proj[2][2] - 1.0);\n                depth = zfar - pos2d.z;\n\n                let half_extent = (abs(v_0) + abs(v_1)) * radius_scale;\n                if DISABLE_AABB_CULL == 1u {\n                    alive = 1u;\n                } else {\n                    let min_pos = v_center - half_extent;\n                    let max_pos = v_center + half_extent;\n                    if max_pos.x > -1.0 && max_pos.y > -1.0 && min_pos.x < 1.0 && min_pos.y < 1.0 {\n                        alive = 1u;\n                    }\n                }\n            }\n        }\n    }\n    scan0[lid.x] = alive;\n\n    workgroupBarrier();\n\n    if (lid.x >= 1u) { scan1[lid.x] = scan0[lid.x] + scan0[lid.x - 1u]; } else { scan1[lid.x] = scan0[lid.x]; } workgroupBarrier();\n    if (lid.x >= 2u) { scan0[lid.x] = scan1[lid.x] + scan1[lid.x - 2u]; } else { scan0[lid.x] = scan1[lid.x]; } workgroupBarrier();\n    if (lid.x >= 4u) { scan1[lid.x] = scan0[lid.x] + scan0[lid.x - 4u]; } else { scan1[lid.x] = scan0[lid.x]; } workgroupBarrier();\n    if (lid.x >= 8u) { scan0[lid.x] = scan1[lid.x] + scan1[lid.x - 8u]; } else { scan0[lid.x] = scan1[lid.x]; } workgroupBarrier();\n    if (lid.x >= 16u) { scan1[lid.x] = scan0[lid.x] + scan0[lid.x - 16u]; } else { scan1[lid.x] = scan0[lid.x]; } workgroupBarrier();\n    if (lid.x >= 32u) { scan0[lid.x] = scan1[lid.x] + scan1[lid.x - 32u]; } else { scan0[lid.x] = scan1[lid.x]; } workgroupBarrier();\n    if (lid.x >= 64u) { scan1[lid.x] = scan0[lid.x] + scan0[lid.x - 64u]; } else { scan1[lid.x] = scan0[lid.x]; } workgroupBarrier();\n    if (lid.x >= 128u) { scan0[lid.x] = scan1[lid.x] + scan1[lid.x - 128u]; } else { scan0[lid.x] = scan1[lid.x]; } workgroupBarrier();\n\n    if (lid.x == 0u) {\n        let group_cnt  = scan0[WG_SIZE - 1u];\n        if (group_cnt != 0u) {\n            group_base = atomicAdd(&sort_infos.keys_size, group_cnt);\n        }\n    }\n    workgroupBarrier();\n\n    if (alive == 1u) {\n        let store_idx = group_base + scan0[lid.x] - 1u;\n        sh_solvers[store_idx] = SHSolver(\n            pack2x16float(dir.xy),\n            pack2x16float(vec2<f32>(dir.z, opacity)),\n            idx,\n        );\n        points_2d[store_idx] = Splat(\n            v_0.x, v_0.y,\n            v_1.x, v_1.y,\n            v_center.x, v_center.y,\n        );\n        sort_depths[store_idx] = bitcast<u32>(depth);\n        sort_indices[store_idx] = store_idx;\n    }\n}\n";

// vendor/websplatter/src/shaders/gaussian_sort_scatter.wgsl
var gaussian_sort_scatter_default = "// shader implementing gpu radix sort.\n\noverride PASS_ID = 0u;  // Pass ID for current radix sort pass\nconst WG_SIZE = 256u;\nconst WORDS_PER_WG   : u32 = WG_SIZE / 32u; // 8 for 256\noverride RS_RADIX_LOG2 = 8u;  // 8 bit radices\noverride RS_RADIX_SIZE = 1u << RS_RADIX_LOG2;    // 256 entries into the radix table\noverride MAX_BIN_SIZE = RS_RADIX_SIZE * WORDS_PER_WG; // legacy (pre-padding)\n\nstruct GeneralInfo{\n  keys_size : u32,  dispatch_x: u32, dispatch_y: u32, dispatch_z: u32,\n  l0_x : u32, l0_y : u32, l0_z : u32, l0_t : u32, // t0\n  l1_x : u32, l1_y : u32, l1_z : u32, l1_t : u32, // t1\n};\n\n@group(0) @binding(0) var<storage, read> infos: GeneralInfo;\n@group(0) @binding(1) var<storage, read> digit_base : array<u32>;\n@group(0) @binding(2) var<storage, read> keys_src : array<u32>;\n@group(0) @binding(3) var<storage, read_write> keys_dst : array<u32>;\n@group(0) @binding(4) var<storage, read> payload_src : array<u32>;\n@group(0) @binding(5) var<storage, read_write> payload_dst : array<u32>;\n@group(0) @binding(6) var<storage, read> wg_prefixes : array<u32>;\n// --------------------------------------------------------------------------------------------------------------\n// Pass 3: Scatter elements to final positions\n// --------------------------------------------------------------------------------------------------------------\n// var<workgroup> sh_digits : array<u32, WG_SIZE>;\n// var<workgroup> bin_flags : array<atomic<u32>, MAX_BIN_SIZE>;\n\nstruct BinWords { words: array<atomic<u32>, WORDS_PER_WG + 1> }\nvar<workgroup> bin_flags : array<BinWords, RS_RADIX_SIZE>; // For each digit: 8 x 32-bit words bitmap\n\n@compute @workgroup_size(WG_SIZE)\nfn scatter_elements(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>, @builtin(num_workgroups) wgs: vec3<u32>) {\n    // for (var i = lid.x; i < RS_RADIX_SIZE * WORDS_PER_WG; i += WG_SIZE) {\n    //     let d = i / WORDS_PER_WG;\n    //     let w = i % WORDS_PER_WG;\n    //     atomicStore(&bin_flags[d].words[w], 0u);\n    // }\n    atomicStore(&bin_flags[lid.x].words[0], 0u);\n    atomicStore(&bin_flags[lid.x].words[1], 0u);\n    atomicStore(&bin_flags[lid.x].words[2], 0u);\n    atomicStore(&bin_flags[lid.x].words[3], 0u);\n    atomicStore(&bin_flags[lid.x].words[4], 0u);\n    atomicStore(&bin_flags[lid.x].words[5], 0u);\n    atomicStore(&bin_flags[lid.x].words[6], 0u);\n    atomicStore(&bin_flags[lid.x].words[7], 0u);\n\n    workgroupBarrier();\n\n    let wg_base  = wid.x * WG_SIZE;\n    let pos = wg_base + lid.x;\n\n    var key: u32;\n    var digit : u32;\n\n    if (pos < infos.keys_size) {\n        key = keys_src[pos];\n        digit = extractBits(key, PASS_ID * RS_RADIX_LOG2, RS_RADIX_LOG2);\n        // 3) Set bit in this digit's bitmap: one 32-thread word\n        let myWord = lid.x >> 5u;                 // /32\n        let myBit  = 1u << (lid.x & 31u);         // %32\n        atomicOr(&bin_flags[digit].words[myWord], myBit);\n    }\n    workgroupBarrier();\n\n    if (pos < infos.keys_size) {\n\n        let myWord = lid.x >> 5u;                 // /32\n        let myBit  = 1u << (lid.x & 31u);         // %32\n        var rank_in_row : u32 = 0u;\n\n        // Accumulate bit counts in preceding full words\n        for (var w = 0u; w < myWord; w++) {\n            let bits = atomicLoad(&bin_flags[digit].words[w]);\n            rank_in_row += countOneBits(bits);\n        }\n        // Add bits below my bit in the current word\n        let cur  = atomicLoad(&bin_flags[digit].words[myWord]);\n        rank_in_row  += countOneBits(cur & (myBit - 1u));\n\n        let global_pos =\n            digit_base[digit] +\n            wg_prefixes[digit * wgs.x + wid.x] +\n            rank_in_row;\n\n        // Write back key/payload\n        keys_dst[global_pos]    = key;\n        payload_dst[global_pos] = payload_src[pos];\n    }\n}\n";

// vendor/websplatter/src/shaders/gaussian_sort_local_histogram.wgsl
var gaussian_sort_local_histogram_default = "// shader implementing gpu radix sort.\n\noverride PASS_ID = 0u;  // Pass ID for current radix sort pass\nconst WG_SIZE = 256u;\noverride RS_RADIX_LOG2 = 8u;  // 8 bit radices\noverride RS_RADIX_SIZE = 1u << RS_RADIX_LOG2;    // 256 entries into the radix table\n\nstruct GeneralInfo{\n  keys_size : u32,  dispatch_x: u32, dispatch_y: u32, dispatch_z: u32,\n  l0_x : u32, l0_y : u32, l0_z : u32, l0_t : u32, // t0\n  l1_x : u32, l1_y : u32, l1_z : u32, l1_t : u32, // t1\n};\n\n@group(0) @binding(0) var<storage, read> infos: GeneralInfo;\n@group(0) @binding(1) var<storage, read> keys_src : array<u32>;\n@group(0) @binding(2) var<storage, read_write> wg_histograms : array<u32>;\n// --------------------------------------------------------------------------------------------------------------\n// NEW MULTI-PASS RADIX SORT IMPLEMENTATION\n// Pass 1: Local histogram generation per workgroup\n// --------------------------------------------------------------------------------------------------------------\nvar<workgroup> local_histogram : array<atomic<u32>, RS_RADIX_SIZE>;\n@compute @workgroup_size(WG_SIZE)\nfn local_histogram_pass(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>, @builtin(num_workgroups) wgs: vec3<u32>) {\n    // Zero local histogram\n    if lid.x < RS_RADIX_SIZE {\n        atomicStore(&local_histogram[lid.x], 0u);\n    }\n    workgroupBarrier();\n    \n    // Process elements and build local histogram + ranks\n    let pos = wid.x * WG_SIZE + lid.x;\n    if (pos < infos.keys_size) {\n        let key = keys_src[pos];\n        let digit = extractBits(key, PASS_ID * RS_RADIX_LOG2, RS_RADIX_LOG2);\n        \n        atomicAdd(&local_histogram[digit], 1u);\n    }\n    workgroupBarrier();\n    \n    // Write workgroup histogram to global memory\n    if lid.x < RS_RADIX_SIZE {\n        wg_histograms[wid.x + lid.x * wgs.x] = atomicLoad(&local_histogram[lid.x]);\n    }\n}\n";

// vendor/websplatter/src/shaders/gaussian_sort_blelloch.wgsl
var gaussian_sort_blelloch_default = "// ============================================================================\n// 2-Level (Nested) Blelloch Prefix Scan Kernels (Radix Sort histogram phase)\n// ----------------------------------------------------------------------------\n// This file implements a hierarchical exclusive prefix sum over workgroup\n// histograms laid out as [digit][workgroup]. We use a tile size equal to the\n// workgroup size so each invocation owns exactly one element (no inner loops).\n//\n// Pipeline of passes for one radix digit plane (repeated for all digits):\n//   (A) prefix_l0_tile_scan              : per-element scan in tiles of wg histograms\n//       -> produces wg_prefixes (exclusive) + l0_sums (per tile totals)\n//   (B) prefix_l1_tile_scan_on_l0_sums   : scan l0_sums producing l0_offsets + l1_sums\n//   (C) prefix_scan_l1_sums              : scan l1_sums producing l1_offsets\n//   (D) prefix_add_l1_to_l0_offsets      : add l1_offsets back to l0_offsets\n//   (E) prefix_add_l0_to_elements        : add final l0_offsets to element prefixes\n//   (F) compute_digit_base               : final scan across digits to get digit_base\n//\n// All scans are Blelloch (exclusive) using a shared workgroup array `temp`.\n// We intentionally keep loops with compile-time bounds (WG_SIZE) for the\n// compiler to unroll/optimize. No algorithmic / memory access pattern change\n// has been made\u2014only clarity improvements and richer commentary.\n//\n// NOTE: RS_RADIX_SIZE == WG_SIZE (256) here, allowing reuse of the same\n// Blelloch logic for digit_base without an extra buffer.\n// ============================================================================\n\noverride WG_SIZE        : u32 = 256u;  // 1 thread \u2194 1 element (no inner striding)\n\n// Dispatch / tiling metadata passed from host.\n// l0_t: number of L0 tiles      (ceil(dispatch_x / WG_SIZE))\n// l1_t: number of L1 tiles over l0_t (ceil(l0_t / WG_SIZE))\nstruct GeneralInfo {\n  keys_size  : u32,  // Total number of keys (for context)\n  dispatch_x : u32,  // Number of workgroups along x for histogram source\n  dispatch_y : u32,  // (digits) normally RS_RADIX_SIZE or batched digits\n  dispatch_z : u32,\n  l0_x       : u32,  // Mirrors grid dims for L0 (informational)\n  l0_y       : u32,\n  l0_z       : u32,\n  l0_t       : u32,  // Number of L0 tiles per digit\n  l1_x       : u32,  // Mirrors grid dims for L1 (informational)\n  l1_y       : u32,\n  l1_z       : u32,\n  l1_t       : u32,  // Number of L1 tiles over L0 tiles per digit\n};\n\n// in/out buffers\n@group(0) @binding(0) var<storage, read>        infos         : GeneralInfo;\n@group(0) @binding(1) var<storage, read>        wg_histograms : array<u32>; // [digit][wg]\n@group(0) @binding(2) var<storage, read_write>  wg_prefixes   : array<u32>; // [digit][wg] (exclusive prefix for each digit)\n@group(0) @binding(3) var<storage, read_write>  l0_sums       : array<u32>; // [digit][t0]   per L0 tile total\n@group(0) @binding(4) var<storage, read_write>  l0_offsets    : array<u32>; // [digit][t0]   exclusive scan over l0_sums\n@group(0) @binding(5) var<storage, read_write>  l1_sums       : array<u32>; // [digit][t1]   per L1 tile total (over l0_sums)\n@group(0) @binding(6) var<storage, read_write>  l1_offsets    : array<u32>; // [digit][t1]   exclusive scan over l1_sums\n@group(0) @binding(7) var<storage, read_write>  digit_base    : array<u32>; // length RS_RADIX_SIZE exclusive base per digit\n\nfn idx_hist(d: u32, wg: u32) -> u32 { return d * infos.dispatch_x + wg; }\nfn idx_l0 (d: u32, t0: u32) -> u32 { return d * infos.l0_t + t0; }\nfn idx_l1 (d: u32, t1: u32) -> u32 { return d * infos.l1_t + t1; }\n// Shared scratch used by all kernels (size == WG_SIZE). For digit_base the\n// size matches RS_RADIX_SIZE.\nvar<workgroup> temp : array<u32, WG_SIZE>;\n\n// ---------------------------------------------------------------------------\n// Reusable Blelloch scan helpers (tile-sized, operating on `temp`).\n// We split into up-sweep (returning total) and down-sweep (producing exclusive)\n// so callers needing the tile total (for hierarchical sums) can read it.\n// These operate over the full WG_SIZE; inactive lanes should have been\n// initialized with 0 beforehand.\n// ---------------------------------------------------------------------------\n// NOTE: Manually unrolled for WG_SIZE == 256u (log2=8). If WG_SIZE changes,\n// regenerate this sequence (offsets: 1,2,4,8,16,32,64,128).\nfn blelloch_up_sweep_tile(tid: u32) -> u32 {\n  let ui1 = (tid + 1u) * 2u * 1u - 1u;   if (ui1   < WG_SIZE) { temp[ui1]   += temp[ui1 - 1u]; }     workgroupBarrier();\n  let ui2 = (tid + 1u) * 2u * 2u - 1u;   if (ui2   < WG_SIZE) { temp[ui2]   += temp[ui2 - 2u]; }     workgroupBarrier();\n  let ui4 = (tid + 1u) * 2u * 4u - 1u;   if (ui4   < WG_SIZE) { temp[ui4]   += temp[ui4 - 4u]; }     workgroupBarrier();\n  let ui8 = (tid + 1u) * 2u * 8u - 1u;   if (ui8   < WG_SIZE) { temp[ui8]   += temp[ui8 - 8u]; }     workgroupBarrier();\n  let ui16 = (tid + 1u) * 2u * 16u - 1u; if (ui16  < WG_SIZE) { temp[ui16]  += temp[ui16 - 16u]; }   workgroupBarrier();\n  let ui32 = (tid + 1u) * 2u * 32u - 1u; if (ui32  < WG_SIZE) { temp[ui32]  += temp[ui32 - 32u]; }   workgroupBarrier();\n  let ui64 = (tid + 1u) * 2u * 64u - 1u; if (ui64  < WG_SIZE) { temp[ui64]  += temp[ui64 - 64u]; }   workgroupBarrier();\n  let ui128 = (tid + 1u) * 2u * 128u - 1u; if (ui128 < WG_SIZE) { temp[ui128] += temp[ui128 - 128u]; } workgroupBarrier();\n  return temp[WG_SIZE - 1u]; // inclusive total\n}\n\nfn blelloch_down_sweep_tile_exclusive(tid: u32) {\n  if (tid == 0u) { temp[WG_SIZE - 1u] = 0u; }\n  workgroupBarrier();\n  let di128 = (tid + 1u) * 2u * 128u - 1u; if (di128 < WG_SIZE) { let t = temp[di128 - 128u]; temp[di128 - 128u] = temp[di128]; temp[di128] += t; } workgroupBarrier();\n  let di64  = (tid + 1u) * 2u * 64u  - 1u; if (di64  < WG_SIZE) { let t = temp[di64  - 64u];  temp[di64  - 64u]  = temp[di64];  temp[di64]  += t; } workgroupBarrier();\n  let di32  = (tid + 1u) * 2u * 32u  - 1u; if (di32  < WG_SIZE) { let t = temp[di32  - 32u];  temp[di32  - 32u]  = temp[di32];  temp[di32]  += t; } workgroupBarrier();\n  let di16  = (tid + 1u) * 2u * 16u  - 1u; if (di16  < WG_SIZE) { let t = temp[di16  - 16u];  temp[di16  - 16u]  = temp[di16];  temp[di16]  += t; } workgroupBarrier();\n  let di8   = (tid + 1u) * 2u * 8u   - 1u; if (di8   < WG_SIZE) { let t = temp[di8   - 8u];   temp[di8   - 8u]   = temp[di8];   temp[di8]   += t; } workgroupBarrier();\n  let di4   = (tid + 1u) * 2u * 4u   - 1u; if (di4   < WG_SIZE) { let t = temp[di4   - 4u];   temp[di4   - 4u]   = temp[di4];   temp[di4]   += t; } workgroupBarrier();\n  let di2   = (tid + 1u) * 2u * 2u   - 1u; if (di2   < WG_SIZE) { let t = temp[di2   - 2u];   temp[di2   - 2u]   = temp[di2];   temp[di2]   += t; } workgroupBarrier();\n  let di1   = (tid + 1u) * 2u * 1u   - 1u; if (di1   < WG_SIZE) { let t = temp[di1   - 1u];   temp[di1   - 1u]   = temp[di1];   temp[di1]   += t; } workgroupBarrier();\n}\n\n// Separate helpers for digit_base scan (RS_RADIX_SIZE may conceptually differ\n// though equal here). Kept distinct to avoid introducing an extra branch.\nfn blelloch_up_sweep_digits(d: u32) {\n  // Unrolled for RS_RADIX_SIZE == 256u\n  let ui1 = (d + 1u) * 2u * 1u - 1u;   if (ui1   < WG_SIZE) { temp[ui1]   += temp[ui1 - 1u]; }     workgroupBarrier();\n  let ui2 = (d + 1u) * 2u * 2u - 1u;   if (ui2   < WG_SIZE) { temp[ui2]   += temp[ui2 - 2u]; }     workgroupBarrier();\n  let ui4 = (d + 1u) * 2u * 4u - 1u;   if (ui4   < WG_SIZE) { temp[ui4]   += temp[ui4 - 4u]; }     workgroupBarrier();\n  let ui8 = (d + 1u) * 2u * 8u - 1u;   if (ui8   < WG_SIZE) { temp[ui8]   += temp[ui8 - 8u]; }     workgroupBarrier();\n  let ui16 = (d + 1u) * 2u * 16u - 1u; if (ui16  < WG_SIZE) { temp[ui16]  += temp[ui16 - 16u]; }   workgroupBarrier();\n  let ui32 = (d + 1u) * 2u * 32u - 1u; if (ui32  < WG_SIZE) { temp[ui32]  += temp[ui32 - 32u]; }   workgroupBarrier();\n  let ui64 = (d + 1u) * 2u * 64u - 1u; if (ui64  < WG_SIZE) { temp[ui64]  += temp[ui64 - 64u]; }   workgroupBarrier();\n  let ui128 = (d + 1u) * 2u * 128u - 1u; if (ui128 < WG_SIZE) { temp[ui128] += temp[ui128 - 128u]; } workgroupBarrier();\n}\n\nfn blelloch_down_sweep_digits(d: u32) {\n  if (d == 0u) { temp[WG_SIZE - 1u] = 0u; }\n  workgroupBarrier();\n  let di128 = (d + 1u) * 2u * 128u - 1u; if (di128 < WG_SIZE) { let t = temp[di128 - 128u]; temp[di128 - 128u] = temp[di128]; temp[di128] += t; } workgroupBarrier();\n  let di64  = (d + 1u) * 2u * 64u  - 1u; if (di64  < WG_SIZE) { let t = temp[di64  - 64u];  temp[di64  - 64u]  = temp[di64];  temp[di64]  += t; } workgroupBarrier();\n  let di32  = (d + 1u) * 2u * 32u  - 1u; if (di32  < WG_SIZE) { let t = temp[di32  - 32u];  temp[di32  - 32u]  = temp[di32];  temp[di32]  += t; } workgroupBarrier();\n  let di16  = (d + 1u) * 2u * 16u  - 1u; if (di16  < WG_SIZE) { let t = temp[di16  - 16u];  temp[di16  - 16u]  = temp[di16];  temp[di16]  += t; } workgroupBarrier();\n  let di8   = (d + 1u) * 2u * 8u   - 1u; if (di8   < WG_SIZE) { let t = temp[di8   - 8u];   temp[di8   - 8u]   = temp[di8];   temp[di8]   += t; } workgroupBarrier();\n  let di4   = (d + 1u) * 2u * 4u   - 1u; if (di4   < WG_SIZE) { let t = temp[di4   - 4u];   temp[di4   - 4u]   = temp[di4];   temp[di4]   += t; } workgroupBarrier();\n  let di2   = (d + 1u) * 2u * 2u   - 1u; if (di2   < WG_SIZE) { let t = temp[di2   - 2u];   temp[di2   - 2u]   = temp[di2];   temp[di2]   += t; } workgroupBarrier();\n  let di1   = (d + 1u) * 2u * 1u   - 1u; if (di1   < WG_SIZE) { let t = temp[di1   - 1u];   temp[di1   - 1u]   = temp[di1];   temp[di1]   += t; } workgroupBarrier();\n}\n\n// ---------------------------------------------------------------------------\n// (A) L0 pass\n// Per-digit tile scan over wg_histograms -> produces:\n//   - wg_prefixes (exclusive per element inside each digit plane)\n//   - l0_sums     (tile totals for hierarchical accumulation)\n// ---------------------------------------------------------------------------\n@compute @workgroup_size(WG_SIZE)\nfn prefix_l0_tile_scan(\n  @builtin(workgroup_id)        wid : vec3<u32>,   // x: t0, y: digit\n  @builtin(local_invocation_id) lid : vec3<u32>\n) {\n  let t0    = wid.x;\n  let digit = wid.y;\n\n  let start = t0 * WG_SIZE;\n  // Number of active (in-bounds) lanes for this tile along dispatch_x.\n  let valid = select(0u, min(WG_SIZE, infos.dispatch_x - start), infos.dispatch_x > start);\n\n  let tid = lid.x; // lane id\n\n  var v : u32 = 0u;\n  if (tid < valid) { v = wg_histograms[idx_hist(digit, start + tid)]; }\n  temp[tid] = v;\n  workgroupBarrier();\n\n  // Blelloch scan over tile\n  let total = blelloch_up_sweep_tile(tid);\n  blelloch_down_sweep_tile_exclusive(tid);\n\n  if (tid < valid) { wg_prefixes[idx_hist(digit, start + tid)] = temp[tid]; }\n  if (tid == 0u)    { l0_sums[idx_l0(digit, t0)] = select(0u, total, valid > 0u); }\n}\n\n// ---------------------------------------------------------------------------\n// (B) L1 pass over l0_sums\n// Scan l0_sums in tiles to produce l0_offsets (exclusive within tile) and\n// l1_sums (totals per L1 tile). This is structurally identical to (A) but the\n// source array is l0_sums and destination for element-level offsets is l0_offsets.\n// ---------------------------------------------------------------------------\n@compute @workgroup_size(WG_SIZE)\nfn prefix_l1_tile_scan_on_l0_sums(\n  @builtin(workgroup_id)        wid : vec3<u32>,   // x: t1, y: digit\n  @builtin(local_invocation_id) lid : vec3<u32>\n) {\n  let t1    = wid.x;\n  let digit = wid.y;\n\n  let t0_len = infos.l0_t;\n  let start  = t1 * WG_SIZE;\n  let valid  = select(0u, min(WG_SIZE, t0_len - start), t0_len > start);\n\n  let tid = lid.x;\n\n  var v : u32 = 0u;\n  if (tid < valid) { v = l0_sums[idx_l0(digit, start + tid)]; }\n  temp[tid] = v;\n  workgroupBarrier();\n\n  let total = blelloch_up_sweep_tile(tid);\n  blelloch_down_sweep_tile_exclusive(tid);\n\n  if (tid < valid) { l0_offsets[idx_l0(digit, start + tid)] = temp[tid]; }\n  if (tid == 0u)    { l1_sums[idx_l1(digit, t1)] = select(0u, total, valid > 0u); }\n}\n\n// ---------------------------------------------------------------------------\n// (C) Scan l1_sums -> l1_offsets (single workgroup per digit)\n// Assumes infos.l1_t <= WG_SIZE. Add further level if this can be exceeded.\n// ---------------------------------------------------------------------------\n@compute @workgroup_size(WG_SIZE)\nfn prefix_scan_l1_sums(\n  @builtin(workgroup_id)        wid : vec3<u32>,   // y: digit\n  @builtin(local_invocation_id) lid : vec3<u32>\n) {\n  let digit = wid.y;\n  let T = infos.l1_t;\n\n  let tid = lid.x;\n\n  var v : u32 = 0u;\n  if (tid < T) { v = l1_sums[idx_l1(digit, tid)]; }\n  temp[tid] = v;\n  workgroupBarrier();\n\n  blelloch_up_sweep_tile(tid); // total not needed here\n  blelloch_down_sweep_tile_exclusive(tid);\n  if (tid < T) { l1_offsets[idx_l1(digit, tid)] = temp[tid]; }\n}\n\n// ---------------------------------------------------------------------------\n// (D) Add l1_offsets into l0_offsets for each corresponding L0 tile.\n// ---------------------------------------------------------------------------\n@compute @workgroup_size(WG_SIZE)\nfn prefix_add_l1_to_l0_offsets(\n  @builtin(workgroup_id)        wid : vec3<u32>,   // x: t1, y: digit\n  @builtin(local_invocation_id) lid : vec3<u32>\n) {\n  let t1    = wid.x;\n  let digit = wid.y;\n\n  let t0_len = infos.l0_t;\n  let start  = t1 * WG_SIZE;\n  let valid  = select(0u, min(WG_SIZE, t0_len - start), t0_len > start);\n  let add    = l1_offsets[idx_l1(digit, t1)];\n\n  let tid = lid.x;\n  if (tid < valid) {\n    let idx = idx_l0(digit, start + tid);\n    l0_offsets[idx] += add;\n  }\n}\n\n// ---------------------------------------------------------------------------\n// (E) Add final l0_offsets back to element-level wg_prefixes.\n// ---------------------------------------------------------------------------\n@compute @workgroup_size(WG_SIZE)\nfn prefix_add_l0_to_elements(\n  @builtin(workgroup_id)        wid : vec3<u32>,   // x: t0, y: digit\n  @builtin(local_invocation_id) lid : vec3<u32>\n) {\n  let t0    = wid.x;\n  let digit = wid.y;\n\n  let start = t0 * WG_SIZE;\n  let valid = select(0u, min(WG_SIZE, infos.dispatch_x - start), infos.dispatch_x > start);\n  let add   = l0_offsets[idx_l0(digit, t0)];\n\n  let tid = lid.x;\n  if (tid < valid) {\n    let idx = idx_hist(digit, start + tid);\n    wg_prefixes[idx] += add;\n  }\n}\n\n@compute @workgroup_size(WG_SIZE)\nfn compute_digit_base(\n  @builtin(local_invocation_id) lid : vec3<u32>\n) {\n  let d = lid.x; // digit 0..255\n\n  // Gather total count for digit d into temp[d]\n  var tot : u32 = 0u;\n  if (infos.dispatch_x > 0u) {\n    let last = infos.dispatch_x - 1u;\n    let idx  = idx_hist(d, last);\n    tot = wg_prefixes[idx] + wg_histograms[idx];\n  }\n  temp[d] = tot;\n  workgroupBarrier();\n\n  // Blelloch exclusive scan over digits -------------------------------\n  blelloch_up_sweep_digits(d);\n  blelloch_down_sweep_digits(d);\n  // Exclusive result -> digit_base\n  digit_base[d] = temp[d];\n}\n\n@compute @workgroup_size(WG_SIZE)\nfn compute_digit_base1(\n  @builtin(local_invocation_id) lid : vec3<u32>\n) {\n  let d = lid.x; // digit 0..255 (one lane per digit)\n  // Gather total count for digit d (tile total for that digit plane)\n  let idx  = idx_hist(d, infos.dispatch_x - 1u);\n  temp[d] = wg_prefixes[idx] + wg_histograms[idx];\n  workgroupBarrier();\n  // Hillis-Steele inclusive scan (log2(256)=8 iterations)\n  // offset 1\n  let add1   = select(0u, temp[d - 1u],   d >= 1u);\n  workgroupBarrier(); temp[d] = temp[d] + select(0u, add1,   d >= 1u);   workgroupBarrier();\n  // offset 2\n  let add2   = select(0u, temp[d - 2u],   d >= 2u);\n  workgroupBarrier(); temp[d] = temp[d] + select(0u, add2,   d >= 2u);   workgroupBarrier();\n  // offset 4\n  let add4   = select(0u, temp[d - 4u],   d >= 4u);\n  workgroupBarrier(); temp[d] = temp[d] + select(0u, add4,   d >= 4u);   workgroupBarrier();\n  // offset 8\n  let add8   = select(0u, temp[d - 8u],   d >= 8u);\n  workgroupBarrier(); temp[d] = temp[d] + select(0u, add8,   d >= 8u);   workgroupBarrier();\n  // offset 16\n  let add16  = select(0u, temp[d - 16u],  d >= 16u);\n  workgroupBarrier(); temp[d] = temp[d] + select(0u, add16,  d >= 16u);  workgroupBarrier();\n  // offset 32\n  let add32  = select(0u, temp[d - 32u],  d >= 32u);\n  workgroupBarrier(); temp[d] = temp[d] + select(0u, add32,  d >= 32u);  workgroupBarrier();\n  // offset 64\n  let add64  = select(0u, temp[d - 64u],  d >= 64u);\n  workgroupBarrier(); temp[d] = temp[d] + select(0u, add64,  d >= 64u);  workgroupBarrier();\n  // offset 128\n  let add128 = select(0u, temp[d - 128u], d >= 128u);\n  workgroupBarrier(); temp[d] = temp[d] + select(0u, add128, d >= 128u); workgroupBarrier();\n  // Convert inclusive -> exclusive: shift right by one (digit 0 -> 0)\n  digit_base[d] = select(0u, temp[d - 1u], d > 0u);\n}";

// vendor/websplatter/src/utils/simple-console.ts
var log = console.debug;

// vendor/websplatter/src/render-settings.ts
var RENDER_SETTINGS_SIZE = 32;
var RenderSettingsValues = new ArrayBuffer(RENDER_SETTINGS_SIZE);
var RenderSettingsViews = {
  canvas_size: new Uint32Array(RenderSettingsValues, 0, 2),
  max_sh_deg: new Uint32Array(RenderSettingsValues, 8, 1),
  cur_sh_deg: new Uint32Array(RenderSettingsValues, 12, 1),
  gaussian_scaling: new Float32Array(RenderSettingsValues, 16, 1),
  kernel_size: new Float32Array(RenderSettingsValues, 20, 1),
  mip_spatting: new Uint32Array(RenderSettingsValues, 24, 1),
  walltime: new Float32Array(RenderSettingsValues, 28, 1)
};
function initRenderSettings(params) {
  RenderSettingsViews.canvas_size[0] = params.width >>> 0;
  RenderSettingsViews.canvas_size[1] = params.height >>> 0;
  RenderSettingsViews.max_sh_deg[0] = params.max_sh_deg >>> 0;
  RenderSettingsViews.cur_sh_deg[0] = (params.cur_sh_deg ?? params.max_sh_deg) >>> 0;
  RenderSettingsViews.gaussian_scaling[0] = params.gaussian_scaling ?? 1;
  RenderSettingsViews.kernel_size[0] = params.kernel_size ?? 0.3;
  RenderSettingsViews.mip_spatting[0] = (typeof params.mip_spatting === "boolean" ? params.mip_spatting ? 1 : 0 : params.mip_spatting ?? 0) >>> 0;
  RenderSettingsViews.walltime[0] = params.walltime ?? 0;
}
function writeRenderSettings(device, buffer) {
  device.queue.writeBuffer(buffer, 0, RenderSettingsValues);
}
function flush(device, buffer, commit) {
  if (commit && device && buffer) writeRenderSettings(device, buffer);
}
function setCanvasSize(w, h, device, buffer, commit = true) {
  RenderSettingsViews.canvas_size[0] = w >>> 0;
  RenderSettingsViews.canvas_size[1] = h >>> 0;
  flush(device ?? null, buffer ?? null, commit);
}

// vendor/websplatter/src/utils/util.ts
function PadTo4Bytes(size) {
  return size + 3 & ~3;
}

// vendor/websplatter/src/gaussian-renderer.ts
var C_WORKGROUP_SIZE_PREPROCESS = 256;
var C_SIZE_RENDER_SETTINGS_BUFFER = RENDER_SETTINGS_SIZE;
var C_TIMESTAMP_COUNT = 8;
var C_SIZE_2D_SPLAT_F32 = 24;
var C_SIZE_2D_SPLAT_F16 = 12;
var C_SIZE_COLOR_F32 = 16;
var C_SIZE_COLOR_F16 = 8;
var RADIX_BITS_PER_PASS = 8;
var RADIX_SIZE = 1 << RADIX_BITS_PER_PASS;
var WORKGROUP_SIZE = 256;
var TOTAL_PASSES = 32 / RADIX_BITS_PER_PASS;
function createPingPongBuffers(adjusted, device) {
  return {
    sort_indices_buffer: device.createBuffer({
      label: "ping-pong payload (indices)",
      size: adjusted * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    }),
    sort_depths_buffer: device.createBuffer({
      label: "ping-pong keys (depths)",
      size: adjusted * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    })
  };
}
function createHierarchicalBlelloch(device, prefixModule) {
  const prefixBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }
    ]
  });
  const prefixLayout = device.createPipelineLayout({ bindGroupLayouts: [prefixBindGroupLayout] });
  const mk = (entryPoint) => device.createComputePipeline({
    layout: prefixLayout,
    compute: {
      module: prefixModule,
      entryPoint,
      constants: {
        WG_SIZE: WORKGROUP_SIZE
        // RS_RADIX_SIZE: RADIX_SIZE
      }
    }
  });
  return {
    l0TileScan: mk("prefix_l0_tile_scan"),
    l1TileScanOnL0: mk("prefix_l1_tile_scan_on_l0_sums"),
    l1ScanSums: mk("prefix_scan_l1_sums"),
    addL1ToL0: mk("prefix_add_l1_to_l0_offsets"),
    addL0ToElems: mk("prefix_add_l0_to_elements"),
    computeDigitBase: mk("compute_digit_base"),
    prefixBindGroupLayout
  };
}
function createRadixPassPipelines(device, histogramModule, scatterModule) {
  const localHistogramBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }
    ]
  });
  const scatterBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }
    ]
  });
  const histogramLayout = device.createPipelineLayout({ bindGroupLayouts: [localHistogramBindGroupLayout] });
  const scatterLayout = device.createPipelineLayout({ bindGroupLayouts: [scatterBindGroupLayout] });
  const passes = [];
  for (let i = 0; i < TOTAL_PASSES; i++) {
    const constants = { PASS_ID: i, RS_RADIX_LOG2: RADIX_BITS_PER_PASS, RS_RADIX_SIZE: RADIX_SIZE };
    passes.push({
      localHistogram: device.createComputePipeline({
        layout: histogramLayout,
        compute: { module: histogramModule, entryPoint: "local_histogram_pass", constants }
      }),
      scatterElements: device.createComputePipeline({
        layout: scatterLayout,
        compute: { module: scatterModule, entryPoint: "scatter_elements", constants }
      })
    });
  }
  return { passes, localHistogramBindGroupLayout, scatterBindGroupLayout };
}
function buildPipelines(device) {
  const histogramModule = device.createShaderModule({ label: "local histogram", code: gaussian_sort_local_histogram_default });
  const scatterModule = device.createShaderModule({ label: "scatter", code: gaussian_sort_scatter_default });
  const prefixModule = device.createShaderModule({ label: "blelloch prefix", code: gaussian_sort_blelloch_default });
  const hierarchicalBlelloch = createHierarchicalBlelloch(device, prefixModule);
  const radix = createRadixPassPipelines(device, histogramModule, scatterModule);
  return {
    localHistogramBindGroupLayout: radix.localHistogramBindGroupLayout,
    scatterBindGroupLayout: radix.scatterBindGroupLayout,
    passes: radix.passes,
    hierarchicalBlelloch
  };
}
var GaussianRenderer = class {
  device;
  pc;
  presentationFormat;
  // --- Core Resources ---
  camera_buffer;
  render_settings_buffer;
  draw_indirect_buffer;
  splat_2d_buffer;
  // --- Timestamp Query Resources (only when timestamp-query is enabled) ---
  timeQueryEnabled;
  querySet;
  resolveBuffer;
  resultBuffer;
  // --- Timestamp Ring Buffer Controls ---
  queriesPerFrame = C_TIMESTAMP_COUNT;
  queryCapacityFrames = 200;
  // 100 × N
  sort_prefixBindGroup;
  sort_pipelines;
  sort_localHistogramBindGroups;
  sort_scatterBindGroups;
  get totalQueryCount() {
    return this.queriesPerFrame * this.queryCapacityFrames;
  }
  // Ring write/read tracking
  lastFrame = 0;
  // total frames rendered since start (monotonic)
  frameCount = 0;
  // frames rendered since last read
  // --- Child Modules & Pipelines ---
  // private readonly sorter: SortStuff;
  preprocessPipeline;
  cullPipeline;
  renderPipeline;
  indirectPipeline;
  sort_info_buffer;
  sort_ping_pong;
  // --- Bind Groups ---
  crsBg;
  gsBg;
  cullBg2;
  preprocessBg1;
  renderSplatsBindGroup;
  indirectBindGroup;
  // Buffers for culling/compaction
  sh_color_rgba_buffer;
  sh_solvers_buffer;
  // Per-splat sizes (vary by ply_precision)
  splatSize;
  colorSize;
  // One-shot perf dialog flag
  showPerfDialogNext = false;
  // One-shot CPU-side reorder trigger flags
  requestReorderNextFrame = false;
  reorderInFlight = false;
  // One-shot CSV download trigger for next readPerfMetrics
  downloadOnceNextRead = false;
  downloadOnceFileName = "fps_metrics";
  allFrameTimes = [];
  constructor(pc, device, presentationFormat, camera_buffer, features_list, disableAabbCull = false, disableOpacityRadius = false, enableF16Feature = true) {
    this.pc = pc;
    this.device = device;
    const f16_enabled = features_list.includes("shader-f16") && enableF16Feature;
    this.timeQueryEnabled = features_list.includes("timestamp-query");
    const plyF16 = (this.pc.ply_precision ?? "f16") === "f16";
    this.splatSize = plyF16 ? C_SIZE_2D_SPLAT_F16 : C_SIZE_2D_SPLAT_F32;
    this.colorSize = plyF16 ? C_SIZE_COLOR_F16 : C_SIZE_COLOR_F32;
    log(`\u{1F680} enable_f16_feature: ${f16_enabled}`);
    log(`\u{1F4BE} ply_precision: ${this.pc.ply_precision ?? "f16"}`);
    const cullName = plyF16 ? "gaussian_cull.wgsl" : "gaussian_cull_plyf32.wgsl";
    const preprocessName = f16_enabled ? plyF16 ? "preprocess_f16.wgsl" : "preprocess_f16_plyf32.wgsl" : plyF16 ? "preprocess_f32.wgsl" : "preprocess_f32_plyf32.wgsl";
    const renderName = plyF16 ? "gaussian_render_conic.wgsl" : "gaussian_render_conic_plyf32.wgsl";
    log(`\u{1F4E6} shaders: ${cullName}, ${preprocessName}, ${renderName}`);
    this.presentationFormat = presentationFormat;
    this.camera_buffer = camera_buffer;
    device.addEventListener("uncapturederror", (event) => {
      console.error("A WebGPU error was not captured:", event.error);
    });
    if (this.timeQueryEnabled) {
      this._setupTimestampQueries();
    }
    this._setupBuffers(pc.sh_degree);
    const adjustedKeyCount = (Math.floor((this.pc.num_points + WORKGROUP_SIZE - 1) / WORKGROUP_SIZE) + 1) * WORKGROUP_SIZE;
    const maxNumWorkgroups = Math.ceil(adjustedKeyCount / WORKGROUP_SIZE);
    console.log(`keys count adjusted: ${adjustedKeyCount}`);
    console.log(`key size: ${this.pc.num_points}`);
    const sortInfoBuffer = device.createBuffer({
      label: "sort info",
      size: 16 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC | GPUBufferUsage.INDIRECT
    });
    this.sort_pipelines = buildPipelines(device);
    const ping_pong = [
      createPingPongBuffers(adjustedKeyCount, device),
      createPingPongBuffers(adjustedKeyCount, device)
    ];
    const wgHistograms = device.createBuffer({
      label: "workgroup histograms",
      size: maxNumWorkgroups * RADIX_SIZE * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });
    const wgPrefixes = device.createBuffer({
      label: "workgroup prefixes",
      size: maxNumWorkgroups * RADIX_SIZE * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });
    const digitBase = device.createBuffer({
      label: "digit base",
      size: RADIX_SIZE * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });
    const T0Max = Math.ceil(maxNumWorkgroups / WORKGROUP_SIZE);
    const T1Max = Math.ceil(T0Max / WORKGROUP_SIZE);
    const l0Sums = device.createBuffer({ label: "prefix l0 sums", size: T0Max * RADIX_SIZE * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    const l0Offsets = device.createBuffer({ label: "prefix l0 offsets", size: T0Max * RADIX_SIZE * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    const l1Sums = device.createBuffer({ label: "prefix l1 sums", size: T1Max * RADIX_SIZE * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    const l1Offsets = device.createBuffer({ label: "prefix l1 offsets", size: T1Max * RADIX_SIZE * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    this.sort_prefixBindGroup = device.createBindGroup({
      label: "prefix 2L bind group",
      layout: this.sort_pipelines.hierarchicalBlelloch.prefixBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: sortInfoBuffer } },
        { binding: 1, resource: { buffer: wgHistograms } },
        { binding: 2, resource: { buffer: wgPrefixes } },
        { binding: 3, resource: { buffer: l0Sums } },
        { binding: 4, resource: { buffer: l0Offsets } },
        { binding: 5, resource: { buffer: l1Sums } },
        { binding: 6, resource: { buffer: l1Offsets } },
        { binding: 7, resource: { buffer: digitBase } }
      ]
    });
    this.sort_localHistogramBindGroups = [
      device.createBindGroup({
        label: "localHistogram src=0",
        layout: this.sort_pipelines.localHistogramBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: sortInfoBuffer } },
          { binding: 1, resource: { buffer: ping_pong[0].sort_depths_buffer } },
          { binding: 2, resource: { buffer: wgHistograms } }
        ]
      }),
      device.createBindGroup({
        label: "localHistogram src=1",
        layout: this.sort_pipelines.localHistogramBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: sortInfoBuffer } },
          { binding: 1, resource: { buffer: ping_pong[1].sort_depths_buffer } },
          { binding: 2, resource: { buffer: wgHistograms } }
        ]
      })
    ];
    this.sort_scatterBindGroups = [
      device.createBindGroup({
        label: "scatter 0->1",
        layout: this.sort_pipelines.scatterBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: sortInfoBuffer } },
          { binding: 1, resource: { buffer: digitBase } },
          { binding: 2, resource: { buffer: ping_pong[0].sort_depths_buffer } },
          { binding: 3, resource: { buffer: ping_pong[1].sort_depths_buffer } },
          { binding: 4, resource: { buffer: ping_pong[0].sort_indices_buffer } },
          { binding: 5, resource: { buffer: ping_pong[1].sort_indices_buffer } },
          { binding: 6, resource: { buffer: wgPrefixes } }
        ]
      }),
      device.createBindGroup({
        label: "scatter 1->0",
        layout: this.sort_pipelines.scatterBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: sortInfoBuffer } },
          { binding: 1, resource: { buffer: digitBase } },
          { binding: 2, resource: { buffer: ping_pong[1].sort_depths_buffer } },
          { binding: 3, resource: { buffer: ping_pong[0].sort_depths_buffer } },
          { binding: 4, resource: { buffer: ping_pong[1].sort_indices_buffer } },
          { binding: 5, resource: { buffer: ping_pong[0].sort_indices_buffer } },
          { binding: 6, resource: { buffer: wgPrefixes } }
        ]
      })
    ];
    this.sort_info_buffer = sortInfoBuffer;
    this.sort_ping_pong = ping_pong;
    const camera_renderSettings_Bgl = this.device.createBindGroupLayout({
      label: "camera + renderSettings",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } }
      ]
    });
    const gaussians_splats_Bgl = this.device.createBindGroupLayout({
      label: "gaussians + splats",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }
      ]
    });
    const cullBgl2 = this.device.createBindGroupLayout({
      label: "cullBgl2",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }
      ]
    });
    const preprocessBgl2 = this.device.createBindGroupLayout({
      label: "preprocessBgl2",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }
      ]
    });
    this.crsBg = this.device.createBindGroup({
      label: "camera + renderSettings",
      layout: camera_renderSettings_Bgl,
      entries: [
        { binding: 0, resource: { buffer: this.camera_buffer } },
        { binding: 1, resource: { buffer: this.render_settings_buffer } }
      ]
    });
    this.gsBg = this.device.createBindGroup({
      label: "gaussians + splats",
      layout: gaussians_splats_Bgl,
      entries: [
        { binding: 0, resource: { buffer: this.pc.gaussian_3d_buffer } },
        { binding: 1, resource: { buffer: this.splat_2d_buffer } }
      ]
    });
    this.cullBg2 = this.device.createBindGroup({
      label: "cullBg2",
      layout: cullBgl2,
      entries: [
        { binding: 0, resource: { buffer: this.sort_info_buffer } },
        { binding: 1, resource: { buffer: this.sort_ping_pong[0].sort_depths_buffer } },
        { binding: 2, resource: { buffer: this.sort_ping_pong[0].sort_indices_buffer } },
        { binding: 3, resource: { buffer: this.sh_solvers_buffer } }
      ]
    });
    this.preprocessBg1 = this.device.createBindGroup({
      label: "preprocessBg2",
      layout: preprocessBgl2,
      entries: [
        { binding: 0, resource: { buffer: this.sort_info_buffer } },
        { binding: 1, resource: { buffer: this.pc.sh_buffer } },
        { binding: 2, resource: { buffer: this.sh_solvers_buffer } },
        { binding: 3, resource: { buffer: this.sh_color_rgba_buffer } }
      ]
    });
    const indirectModule = this.device.createShaderModule({ code: gaussian_calculate_indirect_dispatch_default });
    this.indirectPipeline = this.device.createComputePipeline({
      label: "indirect dispatch calc",
      layout: "auto",
      compute: { module: indirectModule, entryPoint: "write_dispatch_triples", constants: { RS_RADIX_SIZE: 256 } }
    });
    this.indirectBindGroup = this.device.createBindGroup({
      label: "indirect dispatch bind group",
      layout: this.indirectPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.sort_info_buffer } },
        { binding: 1, resource: { buffer: this.draw_indirect_buffer } }
      ]
    });
    const cullShaderCode = plyF16 ? gaussian_cull_default : gaussian_cull_plyf32_default;
    const preprocessCullShader = this.device.createShaderModule({ code: cullShaderCode });
    this.cullPipeline = this.device.createComputePipeline({
      label: "preprocess_cull",
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [
          camera_renderSettings_Bgl,
          // 0: camera + render settings
          gaussians_splats_Bgl,
          // 1: cull gaussians
          cullBgl2
          // 2: cull sort/active indices
        ]
      }),
      compute: {
        module: preprocessCullShader,
        entryPoint: "preprocess_cull",
        constants: {
          DISABLE_AABB_CULL: disableAabbCull ? 1 : 0,
          DISABLE_OPACITY_RADIUS: disableOpacityRadius ? 1 : 0
        }
      }
    });
    const preprocessCode = f16_enabled ? plyF16 ? preprocess_f16_default : preprocess_f16_plyf32_default : plyF16 ? preprocess_f32_default : preprocess_f32_plyf32_default;
    const preprocessShader = this.device.createShaderModule({ code: preprocessCode });
    this.preprocessPipeline = this.device.createComputePipeline({
      label: "preprocess",
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [
          camera_renderSettings_Bgl,
          preprocessBgl2
        ]
      }),
      compute: {
        module: preprocessShader,
        entryPoint: "preprocess"
      }
    });
    const renderCode = plyF16 ? gaussian_render_conic_default : gaussian_render_conic_plyf32_default;
    const renderShader = this.device.createShaderModule({ code: renderCode });
    const renderConstants = {
      DISABLE_OPACITY_RADIUS: disableOpacityRadius ? 1 : 0
    };
    this.renderPipeline = this.device.createRenderPipeline({
      label: "render",
      layout: "auto",
      vertex: {
        module: renderShader,
        entryPoint: "vs_main",
        constants: renderConstants
      },
      fragment: {
        module: renderShader,
        entryPoint: "fs_main",
        constants: renderConstants,
        targets: [{
          format: this.presentationFormat,
          // HDR target to avoid clamping during blending
          blend: {
            color: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
            alpha: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" }
          }
        }]
      },
      primitive: {
        topology: "triangle-strip",
        cullMode: "none"
      }
    });
    this.renderSplatsBindGroup = this.device.createBindGroup({
      label: "gaussian splats rendering",
      layout: this.renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.splat_2d_buffer } },
        { binding: 1, resource: { buffer: this.sh_color_rgba_buffer } },
        { binding: 2, resource: { buffer: this.sort_ping_pong[0].sort_indices_buffer } }
      ]
    });
  }
  /**
   * Read back real GPU buffers for one pixel and return only splats that overlap that pixel.
   * Uses the actual sorted draw order, compacted points_2d buffer, and colors buffer.
   */
  async debugDumpPixelInputs(px, py, width, height, limit = 1e4) {
    const num = this.pc.num_points;
    if (!num) return { alive: 0, items: [] };
    const bytesSortInfo = 16 * 4;
    const readSortInfo = this.device.createBuffer({ size: bytesSortInfo, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc0 = this.device.createCommandEncoder();
    enc0.copyBufferToBuffer(this.sort_info_buffer, 0, readSortInfo, 0, bytesSortInfo);
    this.device.queue.submit([enc0.finish()]);
    await this.device.queue.onSubmittedWorkDone();
    await readSortInfo.mapAsync(GPUMapMode.READ);
    const infoU32 = new Uint32Array(readSortInfo.getMappedRange());
    const alive = Math.min(infoU32[0] ?? 0, num);
    readSortInfo.unmap();
    readSortInfo.destroy();
    if (!alive) return { alive: 0, items: [] };
    const SH_SOLVER_STRIDE = 12;
    const COLOR_STRIDE = this.colorSize;
    const readSortedIdx = this.device.createBuffer({ size: alive * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const readPoints = this.device.createBuffer({ size: alive * this.splatSize, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const readColors = this.device.createBuffer({ size: alive * COLOR_STRIDE, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const readSolvers = this.device.createBuffer({ size: alive * SH_SOLVER_STRIDE, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.sort_ping_pong[0].sort_indices_buffer, 0, readSortedIdx, 0, alive * 4);
    enc.copyBufferToBuffer(this.splat_2d_buffer, 0, readPoints, 0, alive * this.splatSize);
    enc.copyBufferToBuffer(this.sh_color_rgba_buffer, 0, readColors, 0, alive * COLOR_STRIDE);
    enc.copyBufferToBuffer(this.sh_solvers_buffer, 0, readSolvers, 0, alive * SH_SOLVER_STRIDE);
    this.device.queue.submit([enc.finish()]);
    await this.device.queue.onSubmittedWorkDone();
    await Promise.all([
      readSortedIdx.mapAsync(GPUMapMode.READ),
      readPoints.mapAsync(GPUMapMode.READ),
      readColors.mapAsync(GPUMapMode.READ),
      readSolvers.mapAsync(GPUMapMode.READ)
    ]);
    const sortedIdx = new Uint32Array(readSortedIdx.getMappedRange());
    const pointsView = new DataView(readPoints.getMappedRange());
    const colorsView = new DataView(readColors.getMappedRange());
    const solversView = new DataView(readSolvers.getMappedRange());
    const w = width || 1;
    const h = height || 1;
    const targetNdcX = (2 * px + 1) / w - 1;
    const targetNdcY = 1 - (2 * py + 1) / h;
    const halfToFloat = (h2) => {
      const s = h2 & 32768 ? -1 : 1;
      const e = h2 >> 10 & 31;
      const f = h2 & 1023;
      if (e === 0) return f ? s * Math.pow(2, -14) * (f / 1024) : s * 0;
      if (e === 31) return f ? NaN : s * Infinity;
      return s * Math.pow(2, e - 15) * (1 + f / 1024);
    };
    const unpack2x16 = (packed) => {
      const lo = packed & 65535;
      const hi = packed >>> 16 & 65535;
      return [halfToFloat(lo), halfToFloat(hi)];
    };
    const items = [];
    for (let drawOrder = 0; drawOrder < alive; drawOrder++) {
      const compactIdx = sortedIdx[drawOrder] >>> 0;
      if (compactIdx >= alive) continue;
      const pOff = compactIdx * this.splatSize;
      const cOff = compactIdx * COLOR_STRIDE;
      const sOff = compactIdx * SH_SOLVER_STRIDE;
      let v0, v1, centerNdc;
      if (this.pc.ply_precision === "f16") {
        const v0f = new Float16Array(pointsView.buffer, pointsView.byteOffset + pOff + 0, 2);
        const v1f = new Float16Array(pointsView.buffer, pointsView.byteOffset + pOff + 4, 2);
        const cf = new Float16Array(pointsView.buffer, pointsView.byteOffset + pOff + 8, 2);
        v0 = [Number(v0f[0]), Number(v0f[1])];
        v1 = [Number(v1f[0]), Number(v1f[1])];
        centerNdc = [Number(cf[0]), Number(cf[1])];
      } else {
        v0 = [pointsView.getFloat32(pOff + 0, true), pointsView.getFloat32(pOff + 4, true)];
        v1 = [pointsView.getFloat32(pOff + 8, true), pointsView.getFloat32(pOff + 12, true)];
        centerNdc = [pointsView.getFloat32(pOff + 16, true), pointsView.getFloat32(pOff + 20, true)];
      }
      let rg, ba;
      if (this.pc.ply_precision === "f16") {
        const c = new Float16Array(colorsView.buffer, colorsView.byteOffset + cOff, 4);
        rg = [Number(c[0]), Number(c[1])];
        ba = [Number(c[2]), Number(c[3])];
      } else {
        rg = [colorsView.getFloat32(cOff + 0, true), colorsView.getFloat32(cOff + 4, true)];
        ba = [colorsView.getFloat32(cOff + 8, true), colorsView.getFloat32(cOff + 12, true)];
      }
      const origIdx = solversView.getUint32(sOff + 8, true) >>> 0;
      const gsStride = this.pc.gs_stride;
      const gOff = origIdx * gsStride;
      const covCpu = [
        Number(this.pc.gaussian_cpu[gOff + 4]),
        Number(this.pc.gaussian_cpu[gOff + 5]),
        Number(this.pc.gaussian_cpu[gOff + 6]),
        Number(this.pc.gaussian_cpu[gOff + 7]),
        Number(this.pc.gaussian_cpu[gOff + 8]),
        Number(this.pc.gaussian_cpu[gOff + 9])
      ];
      const rgba = [rg[0], rg[1], ba[0], ba[1]];
      const opacity = rgba[3];
      if (!(opacity > 1 / 255)) continue;
      const rs = Math.sqrt(Math.log(Math.max(1, 255 * opacity)));
      const targetPxX = px + 0.5;
      const targetPxY = py + 0.5;
      const pixelNdcX = targetPxX * 2 / w - 1;
      const pixelNdcY = 1 - targetPxY * 2 / h;
      const diffX = pixelNdcX - centerNdc[0];
      const diffY = pixelNdcY - centerNdc[1];
      const effV0x = v0[0] * rs, effV0y = v0[1] * rs;
      const effV1x = v1[0] * rs, effV1y = v1[1] * rs;
      const det = effV0x * effV1y - effV0y * effV1x;
      if (Math.abs(det) < 1e-12) continue;
      const inv_det = 1 / det;
      const uv_x = (effV1y * diffX - effV1x * diffY) * inv_det;
      const uv_y = (-effV0y * diffX + effV0x * diffY) * inv_det;
      const sigma_sq = uv_x * uv_x + uv_y * uv_y;
      if (sigma_sq > 2) continue;
      const alpha = Math.min(0.99, opacity * Math.exp(-Math.log(Math.max(1, 255 * opacity)) * sigma_sq));
      if (alpha <= 1 / 255) continue;
      items.push({
        drawOrder,
        compactIdx,
        origIdx,
        covCpu,
        centerNdc,
        v0,
        v1,
        rgba,
        uv: [uv_x, uv_y],
        sigma_sq,
        alpha
      });
      if (items.length >= limit) break;
    }
    readSortedIdx.unmap();
    readPoints.unmap();
    readColors.unmap();
    readSolvers.unmap();
    readSortedIdx.destroy();
    readPoints.destroy();
    readColors.destroy();
    readSolvers.destroy();
    return {
      px,
      py,
      width: w,
      height: h,
      alive,
      items
    };
  }
  /**
   * Executes a single frame of rendering.
   * @param encoder - The command encoder for this frame.
   * @param texture_view - The canvas texture view to render to.
   */
  frame(encoder, texture_view) {
    const tq = this.timeQueryEnabled;
    const offsetFrameIndex = (this.lastFrame + this.frameCount) % this.queryCapacityFrames;
    const base = offsetFrameIndex * this.queriesPerFrame;
    {
      encoder.clearBuffer(this.sort_info_buffer, 0, 4);
      const pass = encoder.beginComputePass({
        label: "cull",
        timestampWrites: tq ? {
          querySet: this.querySet,
          beginningOfPassWriteIndex: base + 0,
          // T0: cull start
          endOfPassWriteIndex: base + 1
          // T1: cull end
        } : void 0
      });
      pass.setPipeline(this.cullPipeline);
      pass.setBindGroup(0, this.crsBg);
      pass.setBindGroup(1, this.gsBg);
      pass.setBindGroup(2, this.cullBg2);
      const wgCount = Math.ceil(this.pc.num_points / C_WORKGROUP_SIZE_PREPROCESS);
      pass.dispatchWorkgroups(wgCount, 1, 1);
      pass.end();
    }
    {
      const pass = encoder.beginComputePass({ label: "calculate indirect dispatch" });
      pass.setPipeline(this.indirectPipeline);
      pass.setBindGroup(0, this.indirectBindGroup);
      pass.dispatchWorkgroups(1, 1, 1);
      pass.end();
    }
    {
      const pass = encoder.beginComputePass({
        label: "preprocess",
        timestampWrites: tq ? {
          querySet: this.querySet,
          beginningOfPassWriteIndex: base + 2,
          // T2: preprocess start
          endOfPassWriteIndex: base + 3
          // T3: preprocess end
        } : void 0
      });
      pass.setPipeline(this.preprocessPipeline);
      pass.setBindGroup(0, this.crsBg);
      pass.setBindGroup(1, this.preprocessBg1);
      pass.dispatchWorkgroupsIndirect(this.sort_info_buffer, 4);
      pass.end();
    }
    for (let round = 0; round < TOTAL_PASSES; round++) {
      const flip = round & 1;
      const radixPipelines = this.sort_pipelines.passes[round];
      const histogramBG = this.sort_localHistogramBindGroups[flip];
      const scatterBG = this.sort_scatterBindGroups[flip];
      {
        const pass = encoder.beginComputePass({ label: `upsweep_round${round}`, timestampWrites: tq && round == 0 ? {
          querySet: this.querySet,
          beginningOfPassWriteIndex: base + 4
          // T4: l0TileScan start
        } : void 0 });
        pass.setPipeline(radixPipelines.localHistogram);
        pass.setBindGroup(0, histogramBG);
        pass.dispatchWorkgroupsIndirect(this.sort_info_buffer, 4);
        pass.end();
      }
      {
        const pass = encoder.beginComputePass({ label: `prefix_round${round} - l0TileScan` });
        pass.setPipeline(this.sort_pipelines.hierarchicalBlelloch.l0TileScan);
        pass.setBindGroup(0, this.sort_prefixBindGroup);
        pass.dispatchWorkgroupsIndirect(this.sort_info_buffer, 16);
        pass.end();
      }
      {
        const pass = encoder.beginComputePass({ label: `prefix_round${round} - l1TileScanOnL0` });
        pass.setPipeline(this.sort_pipelines.hierarchicalBlelloch.l1TileScanOnL0);
        pass.setBindGroup(0, this.sort_prefixBindGroup);
        pass.dispatchWorkgroupsIndirect(this.sort_info_buffer, 32);
        pass.end();
      }
      {
        const pass = encoder.beginComputePass({ label: `prefix_round${round} - l1ScanSums` });
        pass.setPipeline(this.sort_pipelines.hierarchicalBlelloch.l1ScanSums);
        pass.setBindGroup(0, this.sort_prefixBindGroup);
        pass.dispatchWorkgroups(1, RADIX_SIZE, 1);
        pass.end();
      }
      {
        const pass = encoder.beginComputePass({ label: `prefix_round${round} - addL1ToL0` });
        pass.setPipeline(this.sort_pipelines.hierarchicalBlelloch.addL1ToL0);
        pass.setBindGroup(0, this.sort_prefixBindGroup);
        pass.dispatchWorkgroupsIndirect(this.sort_info_buffer, 32);
        pass.end();
      }
      {
        const pass = encoder.beginComputePass({ label: `prefix_round${round} - addL0ToElems` });
        pass.setPipeline(this.sort_pipelines.hierarchicalBlelloch.addL0ToElems);
        pass.setBindGroup(0, this.sort_prefixBindGroup);
        pass.dispatchWorkgroupsIndirect(this.sort_info_buffer, 16);
        pass.end();
      }
      {
        const pass = encoder.beginComputePass({ label: `prefix_round${round} - computeDigitBase` });
        pass.setPipeline(this.sort_pipelines.hierarchicalBlelloch.computeDigitBase);
        pass.setBindGroup(0, this.sort_prefixBindGroup);
        pass.dispatchWorkgroups(1, 1, 1);
        pass.end();
      }
      {
        const pass = encoder.beginComputePass({ label: `scatter_round${round}`, timestampWrites: tq && round == TOTAL_PASSES - 1 ? {
          querySet: this.querySet,
          endOfPassWriteIndex: base + 5
          // T5: scatter end
        } : void 0 });
        pass.setPipeline(radixPipelines.scatterElements);
        pass.setBindGroup(0, scatterBG);
        pass.dispatchWorkgroupsIndirect(this.sort_info_buffer, 4);
        pass.end();
      }
    }
    {
      const pass = encoder.beginRenderPass({
        label: "render",
        colorAttachments: [
          {
            view: texture_view,
            loadOp: "clear",
            storeOp: "store",
            clearValue: [0.048, 0.055, 0.053, 1]
          }
        ],
        timestampWrites: tq ? {
          querySet: this.querySet,
          beginningOfPassWriteIndex: base + 6,
          // T6: render start
          endOfPassWriteIndex: base + 7
          // T7: render end
        } : void 0
      });
      pass.setPipeline(this.renderPipeline);
      pass.setBindGroup(0, this.renderSplatsBindGroup);
      pass.drawIndirect(this.draw_indirect_buffer, 0);
      pass.end();
    }
    if (tq) this.frameCount++;
  }
  /**
   * Read per-frame stage breakdown for eval=3 mode.
   * Returns arrays of per-frame timings for each pipeline stage.
   * Requires timestamp-query to be enabled.
   */
  async readBreakdown() {
    if (!this.timeQueryEnabled) {
      throw new Error("readBreakdown() requires timestamp-query feature");
    }
    const encoder = this.device.createCommandEncoder({ label: "breakdown resolve" });
    encoder.resolveQuerySet(this.querySet, 0, this.totalQueryCount, this.resolveBuffer, 0);
    encoder.copyBufferToBuffer(this.resolveBuffer, 0, this.resultBuffer, 0, this.totalQueryCount * 8);
    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();
    await this.resultBuffer.mapAsync(GPUMapMode.READ);
    const times = new BigInt64Array(this.resultBuffer.getMappedRange());
    const framesToRead = Math.min(this.frameCount, this.queryCapacityFrames);
    const startSlot = (this.lastFrame + this.frameCount - framesToRead) % this.queryCapacityFrames;
    const cull_ms = [];
    const preprocess_ms = [];
    const sort_ms = [];
    const render_ms = [];
    for (let f = 0; f < framesToRead; f++) {
      const slot = (startSlot + f) % this.queryCapacityFrames;
      const b = slot * this.queriesPerFrame;
      if (times[b] === 0n || times[b + 7] === 0n || times[b + 7] < times[b]) continue;
      cull_ms.push(Number(times[b + 1] - times[b + 0]) / 1e6);
      preprocess_ms.push(Number(times[b + 3] - times[b + 2]) / 1e6);
      sort_ms.push(Number(times[b + 5] - times[b + 4]) / 1e6);
      render_ms.push(Number(times[b + 7] - times[b + 6]) / 1e6);
    }
    this.resultBuffer.unmap();
    this.lastFrame += this.frameCount;
    this.frameCount = 0;
    return { cull_ms, preprocess_ms, sort_ms, render_ms };
  }
  /**
   * Reads the performance metrics from the last completed frame.
   * This function is async and will resolve when the data is available on the CPU.
   */
  async readPerfMetrics() {
    if (!this.timeQueryEnabled) {
      console.warn("[readPerfMetrics] timestamp-query not enabled, skipping");
      return;
    }
    const encoder = this.device.createCommandEncoder({
      label: "timestamp resolve encoder"
    });
    encoder.resolveQuerySet(
      this.querySet,
      0,
      this.totalQueryCount,
      this.resolveBuffer,
      0
    );
    encoder.copyBufferToBuffer(
      this.resolveBuffer,
      0,
      this.resultBuffer,
      0,
      this.totalQueryCount * 8
    );
    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();
    const stages = [
      ["Total", 7, 0],
      ["Culling", 1, 0],
      ["Preprocess", 3, 2],
      ["Sort", 5, 4],
      ["Render", 7, 6]
    ];
    if (this.frameCount <= 0) {
      return;
    }
    await this.resultBuffer.mapAsync(GPUMapMode.READ);
    const times = new BigInt64Array(this.resultBuffer.getMappedRange());
    const framesToRead = Math.min(this.frameCount, this.queryCapacityFrames);
    const startSlot = (this.lastFrame + this.frameCount - framesToRead) % this.queryCapacityFrames;
    const stageSamples = Array.from({ length: stages.length }, () => []);
    let validFrames = 0;
    for (let f = 0; f < framesToRead; f++) {
      const slot = (startSlot + f) % this.queryCapacityFrames;
      const baseIdx = slot * this.queriesPerFrame;
      let frameValid = true;
      for (let si = 0; si < stages.length; si++) {
        const [_name, endIndex, startIndex] = stages[si];
        if (times[baseIdx + startIndex] === 0n || times[baseIdx + endIndex] === 0n || times[baseIdx + endIndex] < times[baseIdx + startIndex]) {
          frameValid = false;
          break;
        }
      }
      if (!frameValid) {
        if (slot % 60 === 0) {
          console.debug("[timestamp] frame slot", slot, "contains unwritten (0) timestamps, skipped in stats");
        }
        continue;
      }
      validFrames++;
      for (let si = 0; si < stages.length; si++) {
        const [_name, endIndex, startIndex] = stages[si];
        const startTime = Number(times[baseIdx + startIndex]);
        const endTime = Number(times[baseIdx + endIndex]);
        stageSamples[si].push((endTime - startTime) / 1e6);
      }
    }
    if (validFrames === 0) {
      this.resultBuffer.unmap();
      console.warn("[timestamp] No complete frames available (some timestamps are 0). It may be the first frame or the GPU is still filling.");
      return;
    }
    this.allFrameTimes.push(...stageSamples[0]);
    const measuredTimes = [];
    let totalP99 = 0;
    let totalStd = 0;
    let totalAvg = 0;
    for (let si = 0; si < stages.length; si++) {
      const name = stages[si][0];
      const samples = stageSamples[si];
      let mean = 0;
      if (name === "Total") {
        const allSamples = this.allFrameTimes;
        mean = allSamples.reduce((a, b) => a + b, 0) / allSamples.length;
        const sorted = [...allSamples].sort((a, b) => a - b);
        totalP99 = sorted[Math.floor(sorted.length * 0.99)] || 0;
        const variance = allSamples.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / allSamples.length;
        totalStd = Math.sqrt(variance);
        totalAvg = mean;
      } else {
        mean = samples.reduce((a, b) => a + b, 0) / samples.length;
      }
      measuredTimes.push([name, mean]);
    }
    this.lastFrame += this.frameCount;
    this.frameCount = 0;
    const renderMethod = this.constructor.name;
    const output = `[TIMESTAMP - ${renderMethod}]
` + measuredTimes.map(([name, time]) => `${name}: ${time.toFixed(3)}ms`).join("\n") + `
Total P99: ${totalP99.toFixed(3)}ms
Total STD: ${totalStd.toFixed(3)}ms
Total AVG: ${totalAvg.toFixed(3)}ms
Stats computed over ${this.allFrameTimes.length} frames (cumulative)
${this.lastFrame} frames rendered since start`;
    console.log(output);
    console.log("All Frame Times (Total, ms):", JSON.stringify(this.allFrameTimes));
    if (this.downloadOnceNextRead) {
      this.downloadOnceNextRead = false;
      const csvHeader = "Stage,ms\n";
      const csvBody = measuredTimes.map(([name, time]) => `${name},${time.toFixed(3)}`).join("\n");
      const csvContent = "data:text/csv;charset=utf-8," + encodeURIComponent(csvHeader + csvBody);
      const link = document.createElement("a");
      link.href = csvContent;
      link.download = `${this.downloadOnceFileName}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    if (this.showPerfDialogNext) {
      this.showPerfDialogNext = false;
      try {
        alert(output);
      } catch {
        console.warn("Unable to show dialog; metrics printed to console.");
      }
    }
    this.resultBuffer.unmap();
  }
  // ========================================================================
  // PRIVATE SETUP METHODS
  // ========================================================================
  /**
   * Initializes GPU resources for timestamp queries.
   */
  _setupTimestampQueries() {
    this.querySet = this.device.createQuerySet({
      type: "timestamp",
      count: this.totalQueryCount
    });
    const bytes = this.totalQueryCount * 8;
    this.resolveBuffer = this.device.createBuffer({
      size: bytes,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC
    });
    this.resultBuffer = this.device.createBuffer({
      size: bytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
  }
  /**
   * Creates various GPU buffers for settings and indirect drawing.
   */
  _setupBuffers(max_sh_deg) {
    this.render_settings_buffer = this.device.createBuffer({
      label: "render settings",
      size: C_SIZE_RENDER_SETTINGS_BUFFER,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const canvas = document.querySelector("canvas");
    const width = canvas ? canvas.width : 1;
    const height = canvas ? canvas.height : 1;
    initRenderSettings({ width, height, max_sh_deg });
    writeRenderSettings(this.device, this.render_settings_buffer);
    this.splat_2d_buffer = this.device.createBuffer({
      label: "2d gaussians buffer",
      size: this.pc.num_points * this.splatSize,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });
    this.draw_indirect_buffer = this.device.createBuffer({
      label: "draw indirect",
      size: 4 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC | GPUBufferUsage.INDIRECT
    });
    this.device.queue.writeBuffer(this.draw_indirect_buffer, 0, new Uint32Array([4, 0, 0, 0]));
    const SH_SOLVER_STRIDE = 12;
    this.sh_solvers_buffer = this.device.createBuffer({
      label: "sh_solvers",
      size: this.pc.num_points * SH_SOLVER_STRIDE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    });
    this.sh_color_rgba_buffer = this.device.createBuffer({
      label: "sh_color_rgba",
      size: this.pc.num_points * this.colorSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    });
  }
  // ========================================================================
  // PRIVATE RUNTIME METHODS
  // ========================================================================
  /**
   * Request showing a dialog the next time perf metrics are read.
   * This sets a one-shot flag consumed by readPerfMetrics().
   */
  requestPerfDialog() {
    this.showPerfDialogNext = true;
  }
  /**
   * One-shot: request downloading the next readPerfMetrics result as CSV.
   * If a file name is provided, it will be sanitized and used (without extension).
   */
  requestDownloadMetrics(fileName) {
    if (fileName && fileName.trim().length > 0) {
      const sanitized = fileName.trim().replace(/[^a-zA-Z0-9_\-]/g, "_");
      this.downloadOnceFileName = sanitized.length > 0 ? sanitized : this.downloadOnceFileName;
    } else {
      const ts = /* @__PURE__ */ new Date();
      const iso = `${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, "0")}${String(ts.getDate()).padStart(2, "0")}_${String(ts.getHours()).padStart(2, "0")}${String(ts.getMinutes()).padStart(2, "0")}${String(ts.getSeconds()).padStart(2, "0")}`;
      this.downloadOnceFileName = `fps_metrics_${iso}`;
    }
    this.downloadOnceNextRead = true;
  }
  /**
   * Public API: schedule a CPU-side reorder after the next submitted frame finishes.
   */
  requestReorder() {
    this.requestReorderNextFrame = true;
  }
  /**
   * To be called by the app right after queue.submit of a frame.
   * If armed by requestReorder(), performs one-shot readback of sorted indices,
   * builds permutation (alive first, invisible to the back), reorders CPU mirrors,
   * and writes back to GPU buffers.
   */
  async maybeReorderAfterSubmit() {
    if (!this.requestReorderNextFrame || this.reorderInFlight) return;
    this.reorderInFlight = true;
    this.requestReorderNextFrame = false;
    try {
      const num = this.pc.num_points;
      if (!num) return;
      log(`Reordering ${num} splats...`);
      const bytesSortInfo = 16 * 4;
      const readSortInfo = this.device.createBuffer({ size: bytesSortInfo, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const readSortedIdx = this.device.createBuffer({ size: num * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const SH_SOLVER_STRIDE = 12;
      const readSolvers = this.device.createBuffer({ size: num * SH_SOLVER_STRIDE, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = this.device.createCommandEncoder();
      enc.copyBufferToBuffer(this.sort_info_buffer, 0, readSortInfo, 0, bytesSortInfo);
      enc.copyBufferToBuffer(this.sort_ping_pong[0].sort_indices_buffer, 0, readSortedIdx, 0, num * 4);
      enc.copyBufferToBuffer(this.sh_solvers_buffer, 0, readSolvers, 0, num * SH_SOLVER_STRIDE);
      this.device.queue.submit([enc.finish()]);
      await this.device.queue.onSubmittedWorkDone();
      await Promise.all([
        readSortInfo.mapAsync(GPUMapMode.READ),
        readSortedIdx.mapAsync(GPUMapMode.READ),
        readSolvers.mapAsync(GPUMapMode.READ)
      ]);
      const infoU32 = new Uint32Array(readSortInfo.getMappedRange());
      const alive = Math.min(infoU32[0] ?? 0, num);
      const sortedCompacted = new Uint32Array(readSortedIdx.getMappedRange(), 0, alive);
      const solversView = new DataView(readSolvers.getMappedRange());
      const aliveOriginal = new Uint32Array(alive);
      for (let i = 0; i < alive; i++) {
        const compact = sortedCompacted[i] >>> 0;
        const orig = solversView.getUint32(compact * SH_SOLVER_STRIDE + 8, true);
        aliveOriginal[i] = orig >>> 0;
      }
      const seen = new Uint8Array(num);
      for (let i = 0; i < alive; i++) seen[aliveOriginal[i]] = 1;
      const perm = new Uint32Array(num);
      for (let i = 0; i < alive; i++) perm[i] = aliveOriginal[i];
      let p = alive;
      for (let j = 0; j < num; j++) if (seen[j] === 0) perm[p++] = j;
      const gsStride = this.pc.gs_stride;
      const shStride = this.pc.sh_stride;
      const ScalarArray = this.pc.ply_precision === "f32" ? Float32Array : Float16Array;
      const bytesPerScalar = this.pc.ply_precision === "f32" ? 4 : 2;
      const newGauss = new ScalarArray(PadTo4Bytes(num * gsStride * bytesPerScalar) / bytesPerScalar);
      const newSH = new ScalarArray(PadTo4Bytes(num * shStride * bytesPerScalar) / bytesPerScalar);
      for (let i = 0; i < num; i++) {
        const src = perm[i] >>> 0;
        newGauss.set(this.pc.gaussian_cpu.subarray(src * gsStride, (src + 1) * gsStride), i * gsStride);
        newSH.set(this.pc.sh_cpu.subarray(src * shStride, (src + 1) * shStride), i * shStride);
      }
      this.pc.gaussian_cpu = newGauss;
      this.pc.sh_cpu = newSH;
      this.device.queue.writeBuffer(this.pc.gaussian_3d_buffer, 0, this.pc.ply_precision === "f32" ? new Float32Array(newGauss.buffer) : new Uint16Array(newGauss.buffer));
      this.device.queue.writeBuffer(this.pc.sh_buffer, 0, this.pc.ply_precision === "f32" ? new Float32Array(newSH.buffer) : new Uint16Array(newSH.buffer));
      readSortInfo.unmap();
      readSortedIdx.unmap();
      readSolvers.unmap();
      readSortInfo.destroy();
      readSortedIdx.destroy();
      readSolvers.destroy();
      log(`Reordered ${num} splats, moved ${alive} alive splats to the front.`);
    } catch (e) {
      console.warn("[reorder] failed:", e);
    } finally {
      this.reorderInFlight = false;
    }
  }
};
export {
  GaussianRenderer,
  setCanvasSize
};
