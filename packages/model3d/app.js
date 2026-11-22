/* 3D 课堂演示 —— 纯本地 WebGL，无外部依赖 */
(function () {
  'use strict';
  var T = window.THREE;
  if (!T) { document.body.innerHTML = '<p style="padding:24px;font:16px sans-serif">three.js 未能加载，请检查 lib/three.min.js。</p>'; return; }

  var PALETTE = [0x4f8cff, 0xff8a4c, 0x33c48d, 0xa66cff, 0xffc94c, 0xff6b8b, 0x35c3da];
  var NAMES = { box: '长方体', cube: '正方体', sphere: '球', cylinder: '圆柱', cone: '圆锥', prism: '三棱柱', group: '粘合组' };
  var X_AXIS = new T.Vector3(1, 0, 0), Y_AXIS = new T.Vector3(0, 1, 0);

  var st = {
    bodies: [],
    ids: 1,
    selected: [],
    gravity: 9.8,
    sim: { on: false, base: null, t: 0 },
    anims: []
  };
  var lastFoldTargets = [];   // 最近一次折叠算出的目标点（自检用）

  /* ---------------- 渲染基础 ---------------- */
  var canvas = document.getElementById('view');
  var renderer;
  try {
    renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, preserveDrawingBuffer: true });
  } catch (e) {
    document.getElementById('hud').textContent = '这台电脑的 WebGL 不可用，无法运行 3D 演示。';
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;

  var scene = new T.Scene();
  scene.background = new T.Color(0xeef2f7);

  var camera = new T.PerspectiveCamera(45, 1, 0.1, 200);
  var view = { theta: 0.68, phi: 1.02, radius: 7.4, target: new T.Vector3(0, 1.0, 0) };

  function applyCam() {
    camera.position.set(
      view.target.x + view.radius * Math.sin(view.phi) * Math.sin(view.theta),
      view.target.y + view.radius * Math.cos(view.phi),
      view.target.z + view.radius * Math.sin(view.phi) * Math.cos(view.theta)
    );
    camera.lookAt(view.target);
  }

  scene.add(new T.HemisphereLight(0xffffff, 0xd7e0ea, 0.72));
  var sun = new T.DirectionalLight(0xffffff, 0.92);
  sun.position.set(4.5, 8.5, 3.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -8; sun.shadow.camera.right = 8;
  sun.shadow.camera.top = 8; sun.shadow.camera.bottom = -8;
  scene.add(sun);

  var ground = new T.Mesh(
    new T.PlaneGeometry(20, 20),
    new T.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  var grid = new T.GridHelper(20, 20, 0xb9c7d6, 0xdce5ee);
  grid.position.y = 0.001;
  scene.add(grid);

  /* ---------------- 物体 ---------------- */
  function makeMesh(type, dims, color) {
    var geo;
    if (type === 'box' || type === 'cube') geo = new T.BoxGeometry(dims.w, dims.h, dims.d);
    else if (type === 'sphere') geo = new T.SphereGeometry(dims.r, 32, 22);
    else if (type === 'cylinder') geo = new T.CylinderGeometry(dims.r, dims.r, dims.h, 32);
    else if (type === 'cone') geo = new T.ConeGeometry(dims.r, dims.h, 36);
    else if (type === 'prism') geo = new T.CylinderGeometry(dims.r, dims.r, dims.h, 3);
    else geo = new T.BoxGeometry(1, 1, 1);
    var mat = new T.MeshStandardMaterial({ color: color, roughness: 0.48, metalness: 0.06, side: T.DoubleSide });
    var mesh = new T.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  function defaultDims(type) {
    if (type === 'box') return { w: 1.3, h: 0.8, d: 0.9 };
    if (type === 'cube') return { w: 1, h: 1, d: 1 };
    if (type === 'sphere') return { r: 0.5 };
    if (type === 'cylinder') return { r: 0.45, h: 1.0 };
    if (type === 'cone') return { r: 0.5, h: 1.1 };
    if (type === 'prism') return { r: 0.6, h: 0.9 };
    return { w: 1, h: 1, d: 1 };
  }

  function halfHeight(dims) {
    if (dims.h != null) return dims.h / 2;
    if (dims.r != null) return dims.r;
    return 0.5;
  }

  function scatter() {
    var n = st.bodies.length;
    var ang = n * 1.1;
    var rad = n === 0 ? 0 : 0.55 + 0.55 * Math.floor(n / 2);
    return { x: Math.cos(ang) * rad, z: Math.sin(ang) * rad };
  }

  function addBody(type, opts) {
    opts = opts || {};
    var color = opts.color != null ? opts.color : PALETTE[st.bodies.length % PALETTE.length];
    var geoType = type === 'cube' ? 'box' : type;
    var dims = opts.dims || defaultDims(type);
    var mesh = makeMesh(type, dims, color);
    var spot = scatter();
    mesh.position.set(
      opts.x != null ? opts.x : spot.x,
      opts.y != null ? opts.y : halfHeight(dims) + 0.01,
      opts.z != null ? opts.z : spot.z
    );
    if (opts.ry) mesh.rotation.y = opts.ry;
    scene.add(mesh);

    var b = {
      id: st.ids++,
      name: NAMES[type] + ' ' + st.ids,
      obj: mesh,
      type: geoType,
      dims: dims,
      color: color,
      mass: opts.mass != null ? opts.mass : 1,
      e: opts.e != null ? opts.e : 0.4,
      mu: opts.mu != null ? opts.mu : 0.3,
      v0x: opts.v0x || 0,
      v0z: opts.v0z || 0,
      vel: new T.Vector3(),
      isGroup: false,
      members: null,
      net: null
    };
    mesh.userData.bodyId = b.id;
    st.bodies.push(b);
    selectOnly(b.id);
    return b;
  }

  function disposeObj(obj) {
    obj.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach(function (m) { m.dispose(); });
        else o.material.dispose();
      }
    });
  }

  function removeBody(b) {
    if (b.net && b.net.group) { scene.remove(b.net.group); disposeObj(b.net.group); }
    if (typeof clearViewOf === 'function') clearViewOf(b.id);
    scene.remove(b.obj);
    disposeObj(b.obj);
    st.bodies = st.bodies.filter(function (x) { return x.id !== b.id; });
    st.selected = st.selected.filter(function (id) { return id !== b.id; });
  }

  /* ---------------- 选中 ---------------- */
  var helpers = [];

  var camAnim = null;
  function camTo(phi, radius, ty, tx, tz) {
    camAnim = {
      t: 0, dur: 0.55,
      p0: view.phi, r0: view.radius, y0: view.target.y, x0: view.target.x, z0: view.target.z,
      p1: phi, r1: radius, y1: ty,
      x1: tx == null ? view.target.x : tx,
      z1: tz == null ? view.target.z : tz
    };
  }
  function tickCam(dt) {
    if (!camAnim) return;
    var a = camAnim;
    a.t += dt;
    var k = Math.min(1, a.t / a.dur);
    var e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    view.phi = a.p0 + (a.p1 - a.p0) * e;
    view.radius = a.r0 + (a.r1 - a.r0) * e;
    view.target.y = a.y0 + (a.y1 - a.y0) * e;
    view.target.x = a.x0 + (a.x1 - a.x0) * e;
    view.target.z = a.z0 + (a.z1 - a.z0) * e;
    applyCam();
    if (k >= 1) camAnim = null;
  }

  function selectedBodies() {
    return st.bodies.filter(function (b) { return st.selected.indexOf(b.id) >= 0; });
  }

  function selectOnly(id) {
    st.selected = id == null ? [] : [id];
    refreshSelection();
  }

  function toggleSelect(id) {
    var i = st.selected.indexOf(id);
    if (i >= 0) st.selected.splice(i, 1);
    else st.selected.push(id);
    refreshSelection();
  }

  function refreshSelection() {
    helpers.forEach(function (h) { scene.remove(h); h.geometry.dispose(); h.material.dispose(); });
    helpers = [];
    selectedBodies().forEach(function (b) {
      var target = b.net ? b.net.group : b.obj;   // 展开时框住平面图，别框空气
      var h = new T.BoxHelper(target, 0xff9a2e);
      scene.add(h);
      helpers.push(h);
    });
    refreshUI();
  }

  /* ---------------- 视角交互 ---------------- */
  var mode = null, drag = null, lastPt = { x: 0, y: 0 };
  var ray = new T.Raycaster();
  var ndc = new T.Vector2();
  var dragPlane = new T.Plane(new T.Vector3(0, 1, 0), 0);

  function toNdc(ev) {
    var r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    return ndc;
  }

  function pickBody(ev) {
    ray.setFromCamera(toNdc(ev), camera);
    var hits = ray.intersectObjects(scene.children, true);
    for (var i = 0; i < hits.length; i++) {
      var o = hits[i].object;
      while (o && !o.userData.bodyId) o = o.parent;
      if (o && o.userData.bodyId) {
        if (o.userData.inert) continue;   // 展开后藏起来的立体别再被点中、拖走
        var b = st.bodies.filter(function (x) { return x.id === o.userData.bodyId; })[0];
        if (b) return b;
      }
    }
    return null;
  }

  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  canvas.addEventListener('pointerdown', function (ev) {
    canvas.setPointerCapture(ev.pointerId);
    lastPt = { x: ev.clientX, y: ev.clientY };
    var b = pickBody(ev);
    if (b) {
      if (ev.shiftKey) toggleSelect(b.id);
      else if (st.selected.length !== 1 || st.selected[0] !== b.id) selectOnly(b.id);
      if (!st.sim.on && !b.net) {
        mode = 'move';
        dragPlane.constant = -b.obj.position.y;
        ray.setFromCamera(toNdc(ev), camera);
        var p = new T.Vector3();
        if (ray.ray.intersectPlane(dragPlane, p)) drag = { body: b, off: b.obj.position.clone().sub(p) };
        else drag = null;
      }
      return;
    }
    mode = ev.button === 2 ? 'pan' : 'orbit';
    drag = null;
    selectOnly(null);
  });

  canvas.addEventListener('pointermove', function (ev) {
    if (!mode) return;
    var dx = ev.clientX - lastPt.x, dy = ev.clientY - lastPt.y;
    lastPt = { x: ev.clientX, y: ev.clientY };
    if (mode === 'orbit') {
      view.theta -= dx * 0.0075;
      view.phi = Math.min(1.5, Math.max(0.22, view.phi - dy * 0.006));
      applyCam();
    } else if (mode === 'pan') {
      var right = new T.Vector3().setFromMatrixColumn(camera.matrix, 0);
      var up = new T.Vector3().setFromMatrixColumn(camera.matrix, 1);
      var scale = view.radius * 0.0016;
      view.target.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale);
      applyCam();
    } else if (mode === 'move' && drag) {
      ray.setFromCamera(toNdc(ev), camera);
      var p = new T.Vector3();
      if (ray.ray.intersectPlane(dragPlane, p)) {
        var nb = drag.body;
        nb.obj.position.x = Math.min(7, Math.max(-7, p.x + drag.off.x));
        nb.obj.position.z = Math.min(7, Math.max(-7, p.z + drag.off.z));
        helpers.forEach(function (h) { h.update(); });
        syncUIValues(nb);
      }
    }
  });

  function endPointer() { mode = null; drag = null; }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener('wheel', function (ev) {
    ev.preventDefault();
    view.radius = Math.min(20, Math.max(2.4, view.radius * Math.exp(ev.deltaY * 0.0011)));
    applyCam();
  }, { passive: false });

  /* ---------------- 物理 ---------------- */
  function decel(v, f) {
    if (Math.abs(v) <= f) return 0;
    return v - Math.sign(v) * f;
  }

  function boxOf(b) { return new T.Box3().setFromObject(b.obj); }

  function groundPass(h) {
    var g = st.gravity;
    for (var i = 0; i < st.bodies.length; i++) {
      var b = st.bodies[i];
      if (b.fixed || b.net) continue;      // 展开成平面图时不参与物理
      var box = boxOf(b);
      if (box.min.y > 0) continue;
      b.obj.position.y += -box.min.y;
      if (b.vel.y < -0.02) {
        b.vel.y = -b.vel.y * b.e;
        if (b.vel.y < 0.22) b.vel.y = 0;
      } else {
        b.vel.y = 0;
        var f = b.mu * g * h;
        b.vel.x = decel(b.vel.x, f);
        b.vel.z = decel(b.vel.z, f);
      }
    }
  }

  function collide(A, B) {
    if (A.net || B.net) return;
    if (A.fixed && B.fixed) return;
    var a = boxOf(A), c = boxOf(B);
    if (!a.intersectsBox(c)) return;
    var ox = Math.min(a.max.x, c.max.x) - Math.max(a.min.x, c.min.x);
    var oy = Math.min(a.max.y, c.max.y) - Math.max(a.min.y, c.min.y);
    var oz = Math.min(a.max.z, c.max.z) - Math.max(a.min.z, c.min.z);
    if (ox <= 0 || oy <= 0 || oz <= 0) return;

    var axis = 'x', over = ox;
    if (oy <= ox && oy <= oz) { axis = 'y'; over = oy; }
    else if (oz <= ox && oz <= oy) { axis = 'z'; over = oz; }

    var key = axis;
    var dir = (B.obj.position[key] >= A.obj.position[key]) ? 1 : -1;

    var mA = A.fixed ? Infinity : A.mass;
    var mB = B.fixed ? Infinity : B.mass;
    var wA = A.fixed ? 0 : (mB === Infinity ? 1 : mB / (mA + mB));
    var wB = B.fixed ? 0 : (mA === Infinity ? 1 : mA / (mA + mB));

    A.obj.position[key] -= dir * over * wA;
    B.obj.position[key] += dir * over * wB;

    var n = new T.Vector3(axis === 'x' ? dir : 0, axis === 'y' ? dir : 0, axis === 'z' ? dir : 0);
    var vRel = (B.vel.x - A.vel.x) * n.x + (B.vel.y - A.vel.y) * n.y + (B.vel.z - A.vel.z) * n.z;
    if (vRel >= 0) return;
    var e = (A.e + B.e) / 2;
    var invA = A.fixed ? 0 : 1 / A.mass, invB = B.fixed ? 0 : 1 / B.mass;
    if (invA + invB === 0) return;
    var j = -(1 + e) * vRel / (invA + invB);
    if (!A.fixed) { A.vel.x -= j * invA * n.x; A.vel.y -= j * invA * n.y; A.vel.z -= j * invA * n.z; }
    if (!B.fixed) { B.vel.x += j * invB * n.x; B.vel.y += j * invB * n.y; B.vel.z += j * invB * n.z; }
  }

  function pairPass() {
    for (var i = 0; i < st.bodies.length; i++) {
      for (var j = i + 1; j < st.bodies.length; j++) collide(st.bodies[i], st.bodies[j]);
    }
  }

  function rollPass(dt) {
    for (var i = 0; i < st.bodies.length; i++) {
      var b = st.bodies[i];
      if (b.type !== 'sphere' || b.fixed || b.net || !b.dims.r) continue;
      var box = boxOf(b);
      if (box.min.y > 0.03) continue;
      var sp = Math.hypot(b.vel.x, b.vel.z);
      if (sp < 0.03) continue;
      var axis = new T.Vector3(b.vel.z, 0, -b.vel.x).normalize();
      b.obj.rotateOnWorldAxis(axis, sp * dt / Math.max(0.06, b.dims.r));
    }
  }

  function simStep(dt) {
    var SUB = 4, h = dt / SUB;
    for (var s = 0; s < SUB; s++) {
      for (var i = 0; i < st.bodies.length; i++) {
        var b = st.bodies[i];
        if (b.fixed || b.net) continue;
        b.vel.y -= st.gravity * h;
        b.obj.position.addScaledVector(b.vel, h);
      }
      groundPass(h);
      pairPass();
    }
    rollPass(dt);
    helpers.forEach(function (h2) { h2.update(); });
    syncUIValues(selectedBodies()[0]);
    st.sim.t += dt;
  }

  function startSim() {
    if (!st.bodies.length) return toast('先放一个物体再启用模拟');
    if (st.bodies.some(function (b) { return b.net; })) return toast('有物体还是展开的平面图，先折叠回立体再模拟');
    if (st.anims.length) { /* 允许，动画继续 */ }
    st.sim.base = st.bodies.map(function (b) {
      return { b: b, p: b.obj.position.clone(), q: b.obj.quaternion.clone() };
    });
    st.bodies.forEach(function (b) { b.vel.set(b.v0x || 0, 0, b.v0z || 0); });
    st.sim.on = true;
    st.sim.t = 0;
    refreshUI();
  }

  function pauseSim() { st.sim.on = false; refreshUI(); }

  function resetSim() {
    st.sim.on = false;
    if (st.sim.base) {
      st.sim.base.forEach(function (it) {
        if (st.bodies.indexOf(it.b) >= 0) {
          it.b.obj.position.copy(it.p);
          it.b.obj.quaternion.copy(it.q);
          it.b.vel.set(0, 0, 0);
        }
      });
    }
    st.sim.t = 0;
    refreshSelection();
  }

  /* ---------------- 展开 / 折叠 ---------------- */
  function startFaceAnim(list, unfold, onEnd) {
    st.anims.push({
      t: 0,
      dur: 1.0,
      step: function (k) {
        var e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        var p = unfold ? e : 1 - e;
        list.forEach(function (f) {
          f.mesh.position.lerpVectors(f.from.p, f.to.p, p);
          f.mesh.quaternion.copy(f.from.q).slerp(f.to.q, p);
        });
      },
      end: function () { if (onEnd) onEnd(); }
    });
  }

  function unfoldBody(b) {
    if (!b) return toast('先选中一个物体');
    if (b.isGroup) return toast('粘合组不能展开');
    if (b.type !== 'box') return toast('只有长方体 / 正方体可以展开成平面图');
    if (b.net) return toast('已经展开了');
    if (st.sim.on) return toast('先暂停模拟再展开');

    var w = b.dims.w, h = b.dims.h, d = b.dims.d;
    var C = b.obj.position.clone();
    var Q = b.obj.quaternion.clone();
    var FLAT = new T.Quaternion().setFromEuler(new T.Euler(-Math.PI / 2, 0, 0));

    var defs = [
      { off: new T.Vector3(0, -h / 2, 0), sq: new T.Quaternion().setFromAxisAngle(X_AXIS, Math.PI / 2), su: w, sv: d, u0: 0, u1: w, v0: 0, v1: d },
      { off: new T.Vector3(0, 0, d / 2), sq: new T.Quaternion(), su: w, sv: h, u0: 0, u1: w, v0: d, v1: d + h },
      { off: new T.Vector3(0, h / 2, 0), sq: new T.Quaternion().setFromAxisAngle(X_AXIS, -Math.PI / 2), su: w, sv: d, u0: 0, u1: w, v0: d + h, v1: 2 * d + h },
      { off: new T.Vector3(w / 2, 0, 0), sq: new T.Quaternion().setFromAxisAngle(Y_AXIS, Math.PI / 2), su: d, sv: h, u0: w, u1: w + d, v0: 0, v1: d },
      { off: new T.Vector3(-w / 2, 0, 0), sq: new T.Quaternion().setFromAxisAngle(Y_AXIS, -Math.PI / 2), su: d, sv: h, u0: -d, u1: 0, v0: 0, v1: d },
      { off: new T.Vector3(0, 0, -d / 2), sq: new T.Quaternion().setFromAxisAngle(Y_AXIS, Math.PI), su: w, sv: h, u0: 0, u1: w, v0: -h, v1: 0 }
    ];

    var umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
    defs.forEach(function (f) {
      umin = Math.min(umin, f.u0); umax = Math.max(umax, f.u1);
      vmin = Math.min(vmin, f.v0); vmax = Math.max(vmax, f.v1);
    });
    var du = umax - umin, dv = vmax - vmin;

    var group = new T.Group();
    scene.add(group);
    var list = defs.map(function (f, idx) {
      var geo = new T.PlaneGeometry(f.su, f.sv);
      var tint = new T.Color(b.color);
      tint.offsetHSL(0, 0, (idx - 2.5) * 0.05);
      var mat = new T.MeshStandardMaterial({ color: tint, roughness: 0.55, metalness: 0.05, side: T.DoubleSide });
      var mesh = new T.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      var eGeo = new T.EdgesGeometry(geo);
      var eMat = new T.LineBasicMaterial({ color: 0x24344a, transparent: true, opacity: 0.85 });
      var edges = new T.LineSegments(eGeo, eMat);
      mesh.add(edges);

      var startP = f.off.clone().applyQuaternion(Q).add(C);
      var startQ = Q.clone().multiply(f.sq);
      var uc = (f.u0 + f.u1) / 2 - umin - du / 2;
      var vc = (f.v0 + f.v1) / 2 - vmin - dv / 2;
      var endP = new T.Vector3(C.x + uc, 0.02, C.z - vc);

      mesh.position.copy(startP);
      mesh.quaternion.copy(startQ);
      mesh.userData.bodyId = b.id;
      group.add(mesh);
      return {
        mesh: mesh,
        local: { off: f.off.clone(), sq: f.sq.clone() },
        from: { p: startP, q: startQ },
        to: { p: endP, q: FLAT.clone() }
      };
    });

    b.obj.visible = false;
    b.obj.userData.inert = true;
    b.net = { group: group, list: list };
    camTo(0.62, Math.max(view.radius, 9.2), 0.35, C.x, C.z);
    startFaceAnim(list, true, function () {
      toast('展开完成：6 个面摊在平面上');
      refreshSelection();
    });
    refreshUI();
  }

  function foldBody(b) {
    if (!b || !b.net) return toast('当前物体没有展开');
    var net = b.net;
    b.net = null;
    b.obj.userData.inert = false;
    // 折叠目标按「物体此刻的位姿」重算：中途被挪过也不会先飞回老地方再瞬移
    var C = b.obj.position.clone();
    var Q = b.obj.quaternion.clone();
    net.list.forEach(function (f) {
      f.from = { p: f.mesh.position.clone(), q: f.mesh.quaternion.clone() };
      f.to = {
        p: f.local.off.clone().applyQuaternion(Q).add(C),
        q: Q.clone().multiply(f.local.sq)
      };
    });
    lastFoldTargets = net.list.map(function (f) { return f.to.p.clone(); });
    startFaceAnim(net.list, false, function () {
      scene.remove(net.group);
      disposeObj(net.group);
      b.obj.visible = true;
      refreshSelection();
    });
    refreshUI();
  }

  /* ---------------- 视图（把选中物体按某个方向投影成平面轮廓） ---------------- */
  var views = [];       // 已生成的视图：{ bodyId, group, area, poly, dir }
  var viewDir = null;   // 手动锁定的投影方向（指向物体内部）；null = 每次取当前相机方向

  function clearViewOf(id) {
    for (var i = views.length - 1; i >= 0; i--) {
      if (views[i].bodyId === id) {
        scene.remove(views[i].group);
        disposeObj(views[i].group);
        views.splice(i, 1);
      }
    }
  }

  function worldVerts(b) {
    var out = [];
    b.obj.updateMatrixWorld(true);
    b.obj.traverse(function (o) {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
      var pa = o.geometry.attributes.position;
      for (var i = 0; i < pa.count; i++) {
        out.push(new T.Vector3().fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld));
      }
    });
    return out;
  }

  function hull2d(pts) {   // 单调链凸包
    var p = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    if (p.length < 3) return p;
    function cr(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lo = [], up = [];
    p.forEach(function (q) {
      while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
      lo.push(q);
    });
    p.slice().reverse().forEach(function (q) {
      while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
      up.push(q);
    });
    lo.pop(); up.pop();
    return lo.concat(up);
  }

  function polyArea(poly) {
    var s = 0;
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b2 = poly[(i + 1) % poly.length];
      s += a[0] * b2[1] - b2[0] * a[1];
    }
    return Math.abs(s) / 2;
  }

  function projectOf(b, dir) {
    var C = boxOf(b).getCenter(new T.Vector3());
    var n = dir.clone().normalize();
    var right = new T.Vector3().crossVectors(n, new T.Vector3(0, 1, 0));
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    var up = new T.Vector3().crossVectors(right, n).normalize();
    var half = 0.2, halfR = 0.2, halfV = 0.2;
    var pts = worldVerts(b).map(function (p) {
      var d = p.clone().sub(C);
      half = Math.max(half, Math.abs(d.dot(n)));
      halfR = Math.max(halfR, Math.abs(d.dot(right)));
      halfV = Math.max(halfV, Math.abs(d.dot(up)));
      return [d.dot(right), d.dot(up)];
    });
    return { C: C, n: n, right: right, up: up, half: half, halfR: halfR, halfV: halfV, poly: hull2d(pts) };
  }

  function makeView(b, dirIn) {
    if (!b) return toast('先选中一个物体');
    clearViewOf(b.id);
    var pj = projectOf(b, dirIn);
    var poly = pj.poly;
    if (poly.length < 3) return toast('这个方向看不出轮廓，换个角度试试');

    var shape = new T.Shape();
    shape.moveTo(poly[0][0], poly[0][1]);
    for (var i = 1; i < poly.length; i++) shape.lineTo(poly[i][0], poly[i][1]);
    shape.closePath();

    var group = new T.Group();
    var fill = new T.Mesh(
      new T.ShapeGeometry(shape),
      new T.MeshBasicMaterial({ color: b.color, transparent: true, opacity: 0.45, side: T.DoubleSide, depthWrite: false })
    );
    var pts = poly.map(function (q) { return new T.Vector3(q[0], q[1], 0); });
    pts.push(pts[0].clone());
    var loop = new T.Line(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial({ color: 0x24344a }));
    group.add(fill); group.add(loop);

    // 局部 x→right、y→up、z→-n，让平面正对观察者
    var m = new T.Matrix4().makeBasis(pj.right, pj.up, pj.n.clone().negate());
    group.quaternion.setFromRotationMatrix(m);
    // 摆在物体旁边（屏幕右侧），正对镜头，别糊在物体脸上
    // 固定在画面左上方（物体同深度），永远在视野里，不遮物体
    camera.updateMatrixWorld(true);   // 保证 unproject 用的是当前机位
    var dist = camera.position.distanceTo(pj.C);
    var aim = new T.Vector3(-0.46, 0.40, 0.5).unproject(camera);
    group.position.copy(camera.position).addScaledVector(
      aim.sub(camera.position).normalize(), Math.max(3.2, dist));

    scene.add(group);
    var entry = { bodyId: b.id, group: group, area: polyArea(poly), poly: poly, dir: pj.n.clone() };
    views.push(entry);
    refreshUI();
    return entry;
  }

  function viewDirNow() {
    if (viewDir) return viewDir.clone();
    var d = new T.Vector3();
    camera.getWorldDirection(d);
    return d;
  }

  function regenSelected() {
    var b = selectedBodies()[0];
    if (!b) return toast('先选中一个物体');
    makeView(b, viewDirNow());
  }

  function viewFromCamera() {
    var b = selectedBodies()[0];
    if (!b) return toast('先选中一个物体');
    viewDir = viewDirNow();
    makeView(b, viewDir);
  }

  function viewAxis(kind) {
    viewDir = { front: new T.Vector3(0, 0, -1), top: new T.Vector3(0, -1, 0), side: new T.Vector3(-1, 0, 0) }[kind].clone();
    regenSelected();
  }

  function viewSpin(axisName, deg) {
    var axis = axisName === 'x' ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 0, 1);
    viewDir = viewDirNow().applyAxisAngle(axis, deg * Math.PI / 180);
    regenSelected();
  }

  function clearViews() {
    views.slice().forEach(function (v) { clearViewOf(v.bodyId); });
    viewDir = null;
    refreshUI();
    toast('已清除视图');
  }

  /* ---------------- 粘合 ---------------- */
  function glueSelected() {
    var sel = selectedBodies();
    if (sel.length < 2) return toast('按住 Shift 至少选中两个物体再粘合');
    for (var i = 0; i < sel.length; i++) {
      if (sel[i].isGroup) return toast('已经是粘合组了');
      if (sel[i].net) return toast('展开状态的物体先折叠回去');
    }
    var group = new T.Group();
    scene.add(group);
    var members = [];
    for (var k = 0; k < sel.length; k++) {
      var b = sel[k];
      group.attach(b.obj);
      members.push({ obj: b.obj, type: b.type, dims: b.dims, mass: b.mass, e: b.e, mu: b.mu, color: b.color });
      st.bodies = st.bodies.filter(function (x) { return x.id !== b.id; });
    }
    var size = boxOf({ obj: group }).getSize(new T.Vector3());
    var nb = {
      id: st.ids++,
      name: '粘合组 ' + st.ids,
      obj: group,
      type: 'group',
      dims: { w: size.x, h: size.y, d: size.z },
      color: 0x7f8fa4,
      mass: members.reduce(function (s, m) { return s + m.mass; }, 0),
      e: members.reduce(function (s, m) { return s + m.e; }, 0) / members.length,
      mu: members.reduce(function (s, m) { return s + m.mu; }, 0) / members.length,
      v0x: 0, v0z: 0,
      vel: new T.Vector3(),
      isGroup: true,
      members: members,
      net: null
    };
    group.userData.bodyId = nb.id;
    st.bodies.push(nb);
    selectOnly(nb.id);
    toast('已粘合 ' + members.length + ' 个物体，质量合计 ' + nb.mass.toFixed(1) + ' kg');
  }

  function unglue(b) {
    if (!b || !b.isGroup) return toast('选中的不是粘合组');
    var members = b.members.slice();
    scene.remove(b.obj);
    st.bodies = st.bodies.filter(function (x) { return x.id !== b.id; });
    members.forEach(function (m) {
      scene.attach(m.obj);
      var nb = {
        id: st.ids++,
        name: NAMES[m.type] + ' ' + st.ids,
        obj: m.obj,
        type: m.type,
        dims: m.dims,
        color: m.color,
        mass: m.mass, e: m.e, mu: m.mu,
        v0x: 0, v0z: 0,
        vel: new T.Vector3(),
        isGroup: false, members: null, net: null
      };
      m.obj.userData.bodyId = nb.id;
      st.bodies.push(nb);
    });
    st.selected = [];
    refreshSelection();
    toast('已拆开为 ' + members.length + ' 个物体');
  }

  /* ---------------- 交互动作 ---------------- */
  function deleteSelected() {
    var sel = selectedBodies();
    if (!sel.length) return;
    sel.slice().forEach(removeBody);
    st.selected = [];
    refreshSelection();
  }

  function duplicateSelected() {
    var b = selectedBodies()[0];
    if (!b) return;
    if (b.isGroup) return toast('粘合组暂不支持复制');
    var clone = b.obj.clone(true);
    clone.userData.bodyId = null;
    clone.position.x += 1.2;
    scene.add(clone);
    var nb = {
      id: st.ids++,
      name: b.name + ' 副本',
      obj: clone,
      type: b.type,
      dims: b.dims,
      color: b.color,
      mass: b.mass, e: b.e, mu: b.mu,
      v0x: b.v0x, v0z: b.v0z,
      vel: new T.Vector3(),
      isGroup: false, members: null, net: null
    };
    clone.userData.bodyId = nb.id;
    st.bodies.push(nb);
    selectOnly(nb.id);
  }

  function rotateSel(deg) {
    selectedBodies().forEach(function (b) {
      b.obj.rotation.y += deg * Math.PI / 180;
      if (b.obj.rotation.x) b.obj.rotation.x = 0;
      if (b.obj.rotation.z) b.obj.rotation.z = 0;
    });
    refreshSelection();
  }

  function clearScene() {
    st.bodies.slice().forEach(removeBody);
    st.selected = [];
    st.sim.base = null;
    st.sim.on = false;
    refreshSelection();
  }

  /* ---------------- 预设 ---------------- */
  function presetFreeFall() {
    clearScene();
    addBody('cube', { x: 0, z: 0, y: 3.4, mass: 2, e: 0.25, mu: 0.2 });
    toast('自由落体：点「启用模拟」');
  }

  function presetCollision() {
    clearScene();
    addBody('sphere', { x: -1.9, z: 0, y: 0.52, v0x: 2.6, e: 0.75, mu: 0.15 });
    addBody('sphere', { x: 1.9, z: 0, y: 0.52, v0x: -2.6, e: 0.75, mu: 0.15 });
    toast('两球对撞：点「启用模拟」');
  }

  function presetStack() {
    clearScene();
    addBody('box', { x: 0, z: 0, y: 0.41, mass: 1 });
    addBody('box', { x: 0.1, z: 0, y: 1.21, mass: 1 });
    addBody('sphere', { x: 0.05, z: 0, y: 2.4, mass: 1.5, e: 0.3 });
    toast('三体堆叠：点「启用模拟」看它们互相挤压');
  }

  function presetUnfold() {
    clearScene();
    addBody('box', { x: 0, z: 0, y: 1.6, dims: { w: 2.0, h: 1.2, d: 1.4 } });
    toast('已放好一个长方体，点「展开为平面图」');
  }

  /* ---------------- 面板 ---------------- */
  var el = {};
  ['selPanel', 'nonePanel', 'selTitle', 'posX', 'posY', 'posZ', 'rotY',
   'posXv', 'posYv', 'posZv', 'rotYv',
   'mass', 'grav', 'rest', 'fric', 'v0x', 'v0z', 'massv', 'gravv', 'restv', 'fricv', 'v0xv', 'v0zv',
   'gforce', 'simInfo', 'stat', 'btnGlue', 'btnUnglue', 'btnUnfold', 'btnFold', 'btnDel', 'btnDup',
   'btnPlay', 'btnPause', 'toast', 'hud',
   'btnView', 'btnViewF', 'btnViewT', 'btnViewS', 'btnVxL', 'btnVxR', 'btnVzL', 'btnVzR', 'btnViewQ'].forEach(function (id) { el[id] = document.getElementById(id); });

  var toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.className = 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.className = ''; }, 2200);
  }

  function fmt(v, n) { return (v == null ? 0 : v).toFixed(n == null ? 2 : n); }

  function syncUIValues(b) {
    if (!b) return;
    el.posX.value = b.obj.position.x; el.posXv.textContent = fmt(b.obj.position.x, 1);
    el.posY.value = Math.max(0, b.obj.position.y); el.posYv.textContent = fmt(b.obj.position.y, 1);
    el.posZ.value = b.obj.position.z; el.posZv.textContent = fmt(b.obj.position.z, 1);
    var ry = Math.round(T.MathUtils.radToDeg(b.obj.rotation.y) % 360);
    if (ry > 180) ry -= 360;
    el.rotY.value = ry; el.rotYv.textContent = ry + '°';
  }

  function refreshUI() {
    var sel = selectedBodies();
    var one = sel[0] || null;
    el.selPanel.classList.toggle('hidden', !one);
    el.nonePanel.classList.toggle('hidden', !!one);
    el.stat.textContent = st.bodies.length + ' 个物体' + (sel.length > 1 ? ' · 选中 ' + sel.length : '');

    if (one) {
      el.selTitle.textContent = one.name;
      syncUIValues(one);
      el.mass.value = one.mass; el.massv.textContent = fmt(one.mass, 1);
      el.rest.value = one.e; el.restv.textContent = fmt(one.e, 2);
      el.fric.value = one.mu; el.fricv.textContent = fmt(one.mu, 2);
      el.v0x.value = one.v0x; el.v0xv.textContent = fmt(one.v0x, 1);
      el.v0z.value = one.v0z; el.v0zv.textContent = fmt(one.v0z, 1);
    }
    el.grav.value = st.gravity; el.gravv.textContent = fmt(st.gravity, 1);

    var m = one ? one.mass : 0;
    el.gforce.textContent = one
      ? 'G = mg = ' + fmt(m, 1) + ' × ' + fmt(st.gravity, 1) + ' = ' + fmt(m * st.gravity, 2) + ' N'
      : 'G = mg（选中物体后显示）';

    el.btnGlue.disabled = sel.length < 2;
    el.btnUnglue.disabled = !(one && one.isGroup);
    el.btnUnfold.disabled = !(one && one.type === 'box' && !one.isGroup && !one.net);
    el.btnFold.disabled = !(one && one.net);
    el.btnDel.disabled = !one;
    el.btnDup.disabled = !one || one.isGroup;
    el.btnView.disabled = !one;
    el.btnViewF.disabled = !one;
    el.btnViewT.disabled = !one;
    el.btnViewS.disabled = !one;
    el.btnVxL.disabled = !one;
    el.btnVxR.disabled = !one;
    el.btnVzL.disabled = !one;
    el.btnVzR.disabled = !one;
    el.btnViewQ.disabled = views.length === 0;
    el.btnPause.disabled = !st.sim.on;
    el.btnPlay.textContent = st.sim.on ? '模拟中…' : '启用模拟';

    el.simInfo.textContent = st.sim.on
      ? '运行中  t = ' + fmt(st.sim.t, 2) + ' s ｜ g = ' + fmt(st.gravity, 1) + ' m/s²'
      : (st.sim.base ? '已暂停 / 可重置' : '未运行');
  }

  /* ---------------- 绑定 ---------------- */
  document.querySelectorAll('[data-add]').forEach(function (btn) {
    btn.addEventListener('click', function () { addBody(btn.getAttribute('data-add')); });
  });

  el.posX.addEventListener('input', function () {
    var b = selectedBodies()[0]; if (!b) return;
    b.obj.position.x = parseFloat(el.posX.value); syncUIValues(b); helpers.forEach(function (h) { h.update(); });
  });
  el.posY.addEventListener('input', function () {
    var b = selectedBodies()[0]; if (!b) return;
    b.obj.position.y = Math.max(0, parseFloat(el.posY.value)); syncUIValues(b); helpers.forEach(function (h) { h.update(); });
  });
  el.posZ.addEventListener('input', function () {
    var b = selectedBodies()[0]; if (!b) return;
    b.obj.position.z = parseFloat(el.posZ.value); syncUIValues(b); helpers.forEach(function (h) { h.update(); });
  });
  el.rotY.addEventListener('input', function () {
    var b = selectedBodies()[0]; if (!b) return;
    b.obj.rotation.set(0, parseFloat(el.rotY.value) * Math.PI / 180, 0);
    el.rotYv.textContent = el.rotY.value + '°';
    helpers.forEach(function (h) { h.update(); });
  });

  function eachSel(fn) { selectedBodies().forEach(fn); refreshUI(); }
  el.mass.addEventListener('input', function () {
    var v = parseFloat(el.mass.value);
    eachSel(function (b) { b.mass = v; });
    el.massv.textContent = fmt(v, 1);
  });
  el.grav.addEventListener('input', function () {
    st.gravity = parseFloat(el.grav.value);
    el.gravv.textContent = fmt(st.gravity, 1);
    refreshUI();
  });
  el.rest.addEventListener('input', function () {
    var v = parseFloat(el.rest.value);
    eachSel(function (b) { b.e = v; });
    el.restv.textContent = fmt(v, 2);
  });
  el.fric.addEventListener('input', function () {
    var v = parseFloat(el.fric.value);
    eachSel(function (b) { b.mu = v; });
    el.fricv.textContent = fmt(v, 2);
  });
  el.v0x.addEventListener('input', function () {
    var v = parseFloat(el.v0x.value);
    eachSel(function (b) { b.v0x = v; });
    el.v0xv.textContent = fmt(v, 1);
  });
  el.v0z.addEventListener('input', function () {
    var v = parseFloat(el.v0z.value);
    eachSel(function (b) { b.v0z = v; });
    el.v0zv.textContent = fmt(v, 1);
  });

  document.getElementById('btnRotL').addEventListener('click', function () { rotateSel(-15); });
  document.getElementById('btnRotR').addEventListener('click', function () { rotateSel(15); });
  el.btnGlue.addEventListener('click', glueSelected);
  el.btnUnglue.addEventListener('click', function () { unglue(selectedBodies()[0]); });
  el.btnUnfold.addEventListener('click', function () { unfoldBody(selectedBodies()[0]); });
  el.btnFold.addEventListener('click', function () { foldBody(selectedBodies()[0]); });
  el.btnDel.addEventListener('click', deleteSelected);
  el.btnDup.addEventListener('click', duplicateSelected);

  el.btnView.addEventListener('click', viewFromCamera);
  el.btnViewF.addEventListener('click', function () { viewAxis('front'); });
  el.btnViewT.addEventListener('click', function () { viewAxis('top'); });
  el.btnViewS.addEventListener('click', function () { viewAxis('side'); });
  el.btnVxL.addEventListener('click', function () { viewSpin('x', -15); });
  el.btnVxR.addEventListener('click', function () { viewSpin('x', 15); });
  el.btnVzL.addEventListener('click', function () { viewSpin('z', -15); });
  el.btnVzR.addEventListener('click', function () { viewSpin('z', 15); });
  el.btnViewQ.addEventListener('click', clearViews);

  el.btnPlay.addEventListener('click', startSim);
  el.btnPause.addEventListener('click', pauseSim);
  document.getElementById('btnReset').addEventListener('click', resetSim);
  document.getElementById('btnClear').addEventListener('click', clearScene);

  document.getElementById('btnP1').addEventListener('click', presetFreeFall);
  document.getElementById('btnP2').addEventListener('click', presetCollision);
  document.getElementById('btnP3').addEventListener('click', presetStack);
  document.getElementById('btnP4').addEventListener('click', presetUnfold);

  document.getElementById('btnShot').addEventListener('click', function () {
    renderer.render(scene, camera);
    var a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = '3D课堂演示.png';
    a.click();
    toast('已保存截图');
  });
  document.getElementById('btnHome').addEventListener('click', function () {
    camTo(0.72, 7.4, 1.0, 0, 0);
  });

  window.addEventListener('keydown', function (ev) {
    if (ev.target && ev.target.tagName === 'INPUT') return;
    var b = selectedBodies()[0];
    var step = ev.shiftKey ? 0.5 : 0.1;
    if (ev.key === 'Delete' || ev.key === 'Backspace') { deleteSelected(); ev.preventDefault(); }
    else if (ev.key === 'q' || ev.key === 'Q') rotateSel(-15);
    else if (ev.key === 'e' || ev.key === 'E') rotateSel(15);
    else if (ev.key === ' ') { if (st.sim.on) pauseSim(); else startSim(); ev.preventDefault(); }
    else if (b && !st.sim.on) {
      if (ev.key === 'ArrowLeft') { b.obj.position.x -= step; syncUIValues(b); }
      else if (ev.key === 'ArrowRight') { b.obj.position.x += step; syncUIValues(b); }
      else if (ev.key === 'ArrowUp') { b.obj.position.z -= step; syncUIValues(b); }
      else if (ev.key === 'ArrowDown') { b.obj.position.z += step; syncUIValues(b); }
      else return;
      helpers.forEach(function (h) { h.update(); });
      ev.preventDefault();
    }
  });

  /* ---------------- 尺寸与循环 ---------------- */
  function resize() {
    var w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  applyCam();
  resize();

  function tickAnims(dt) {
    for (var i = st.anims.length - 1; i >= 0; i--) {
      var a = st.anims[i];
      a.t += dt;
      var k = Math.min(1, a.t / a.dur);
      a.step(k);
      if (k >= 1) { st.anims.splice(i, 1); if (a.end) a.end(); }
    }
  }

  var last = performance.now();
  var hudTimer = 0;
  function frame(now) {
    var dt = Math.min(0.06, (now - last) / 1000);
    last = now;

    tickAnims(dt);
    tickCam(dt);
    if (st.sim.on) simStep(dt);
    else helpers.forEach(function (h) { h.update(); });

    hudTimer += dt;
    if (hudTimer > 0.25) {
      hudTimer = 0;
      if (st.sim.on) el.simInfo.textContent = '运行中  t = ' + fmt(st.sim.t, 2) + ' s ｜ g = ' + fmt(st.gravity, 1) + ' m/s²';
    }

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  /* ---------------- 自检（仅 ?test=1 时运行，供开发验证） ---------------- */
  function runSelfTest() {
    var log = [];
    var out = document.createElement('pre');
    out.id = 'selftest';
    out.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99;background:#fff;border:1px solid #999;padding:8px;font:12px monospace;max-height:90vh;overflow:auto';
    document.body.appendChild(out);
    function ok(name, cond, extra) { log.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' :: ' + extra : '')); }
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    (async function () {
      try {
        clearScene();
        var b1 = addBody('cube', { x: 0, z: 0, y: 3.4, mass: 2, e: 0.25, mu: 0.2 });
        st.gravity = 9.8;
        b1.vel.set(0, 0, 0);
        for (var i = 0; i < 240; i++) simStep(1 / 60);
        var bx = boxOf(b1);
        ok('自由落体落地贴地', Math.abs(bx.min.y) < 0.02, 'min.y=' + bx.min.y.toFixed(3));
        ok('落地后竖直速度收敛', Math.abs(b1.vel.y) < 0.35, 'vy=' + b1.vel.y.toFixed(3));

        clearScene();
        var s1 = addBody('sphere', { x: -1.9, z: 0, y: 0.52, e: 0.75, mu: 0.1 });
        var s2 = addBody('sphere', { x: 1.9, z: 0, y: 0.52, e: 0.75, mu: 0.1 });
        s1.vel.set(2.6, 0, 0);
        s2.vel.set(-2.6, 0, 0);
        for (var j = 0; j < 180; j++) simStep(1 / 60);
        ok('两球对撞后速度反向', s1.vel.x < -0.2 && s2.vel.x > 0.2,
          'v1=' + s1.vel.x.toFixed(2) + ' v2=' + s2.vel.x.toFixed(2));

        clearScene();
        var g1 = addBody('cube', { x: -0.9, z: 0, y: 0.5 });
        var g2 = addBody('cube', { x: 0.9, z: 0, y: 0.5 });
        st.selected = [g1.id, g2.id];
        glueSelected();
        var grp = st.bodies[0];
        ok('粘合成一个组', st.bodies.length === 1 && grp && grp.isGroup === true, 'n=' + st.bodies.length);
        ok('组质量为成员之和', grp && Math.abs(grp.mass - 2) < 1e-6, 'm=' + (grp && grp.mass));
        ok('组包围盒包住两个物体', grp && grp.dims.w > 2.6, 'w=' + (grp && grp.dims.w.toFixed(2)));
        unglue(grp);
        ok('拆开后恢复两个物体', st.bodies.length === 2, 'n=' + st.bodies.length);

        clearScene();
        var ub = addBody('box', { x: 0, z: 0, y: 1.6, dims: { w: 2.0, h: 1.2, d: 1.4 } });
        st.selected = [ub.id];
        refreshSelection();
        unfoldBody(ub);
        for (var f1 = 0; f1 < 90; f1++) tickAnims(1 / 60);
        var panels = ub.net ? ub.net.list.length : 0;
        var flatY = ub.net ? ub.net.list.reduce(function (m, f) { return Math.max(m, f.mesh.position.y); }, 0) : 99;
        ok('展开出 6 个面', panels === 6, 'n=' + panels);
        ok('展开后摊平贴地', flatY < 0.05, 'y=' + flatY.toFixed(3));
        ok('展开后立体隐藏', ub.obj.visible === false, 'vis=' + ub.obj.visible);
        var area = ub.net ? ub.net.list.reduce(function (s, f) {
          return s + f.mesh.geometry.parameters.width * f.mesh.geometry.parameters.height;
        }, 0) : 0;
        var expect = 2 * (2.0 * 1.2 + 2.0 * 1.4 + 1.2 * 1.4);
        ok('展开总面积等于表面积', Math.abs(area - expect) < 0.25, area.toFixed(2) + ' vs ' + expect.toFixed(2));

        ok('展开后隐藏立体不可再拖', ub.obj.userData.inert === true, 'inert=' + ub.obj.userData.inert);
        ok('展开后选框套住平面图', helpers.length > 0 && helpers[0].object === ub.net.group, 'helper=' + (helpers[0] && helpers[0].object && helpers[0].object.type));

        var netY0 = ub.obj.position.y;
        for (var pz = 0; pz < 60; pz++) simStep(1 / 60);
        ok('展开的物体不参与物理', Math.abs(ub.obj.position.y - netY0) < 1e-6 && ub.vel.y === 0,
          'dy=' + (ub.obj.position.y - netY0).toFixed(4) + ' vy=' + ub.vel.y.toFixed(2));

        ub.obj.position.x = 1.5;   // 模拟「把立体挪走了」
        foldBody(ub);
        var minTx = lastFoldTargets.length ? Math.min.apply(null, lastFoldTargets.map(function (p) { return p.x; })) : -99;
        ok('折叠目标跟随新位置（不是老地方）', minTx > 0.4, 'minX=' + minTx.toFixed(2));
        for (var f2 = 0; f2 < 90; f2++) tickAnims(1 / 60);
        ok('折叠后恢复立体', ub.obj.visible === true && ub.net === null, 'vis=' + ub.obj.visible);
        ok('折叠后不瞬移回原处', Math.abs(ub.obj.position.x - 1.5) < 1e-6, 'x=' + ub.obj.position.x.toFixed(3));

        clearScene();
        var vb = addBody('box', { x: 0, z: 0, y: 0.4, dims: { w: 2.0, h: 1.0, d: 0.6 } });
        st.selected = [vb.id];
        viewAxis('front');
        var aF = views.length ? views[views.length - 1].area : -1;
        ok('正视视图面积 = w×h', Math.abs(aF - 2.0) < 0.08, 'area=' + aF.toFixed(3));
        viewAxis('top');
        var aT = views.length ? views[views.length - 1].area : -1;
        ok('俯视视图面积 = w×d', Math.abs(aT - 1.2) < 0.08, 'area=' + aT.toFixed(3));
        ok('同一物体只保留一个视图', views.length === 1, 'n=' + views.length);
        var d0 = views[0].dir.clone();
        viewSpin('x', 15);
        var d1 = views[0].dir.clone();
        ok('绕 X 旋转改变了投影方向', d0.distanceTo(d1) > 0.05, 'd=' + d0.distanceTo(d1).toFixed(3));
        viewSpin('z', 15);
        ok('绕 Z 旋转后仍有视图', views.length === 1 && views[0].area > 0.05, 'area=' + (views[0] && views[0].area.toFixed(3)));
        clearViews();
        ok('清除视图后场景干净', views.length === 0, 'n=' + views.length);

        clearScene();
        var gp = addBody('sphere', { x: 0, z: 0, y: 3 });
        gp.vel.set(0, 0, 0);
        st.gravity = 4.9;
        for (var k = 0; k < 60; k++) simStep(1 / 60);
        ok('重力改成 4.9 后下落更慢', gp.vel.y > -6 && gp.vel.y < -3, 'vy=' + gp.vel.y.toFixed(2));
      } catch (err) {
        log.push('FAIL 自检异常 :: ' + (err && err.message));
      }
      out.textContent = log.join('\n');
    })();
  }

  /* 演示态截图用（?demo=unfold / glue / sim） */
  function runDemo(kind) {
    if (kind === 'unfold') {
      clearScene();
      addBody('box', { x: 0, z: 0, y: 1.5, dims: { w: 2.4, h: 1.2, d: 1.6 } });
      unfoldBody(st.bodies[0]);
      for (var i = 0; i < 90; i++) tickAnims(1 / 60);
      for (var ci = 0; ci < 60; ci++) tickCam(1 / 60);
      view.theta = 0.0;
      applyCam();
      st.selected = [];
      refreshSelection();
    } else if (kind === 'glue') {
      clearScene();
      var a = addBody('cube', { x: -0.55, z: 0, y: 0.5, dims: { w: 0.9, h: 0.9, d: 0.9 } });
      var b = addBody('sphere', { x: 0.62, z: 0, y: 0.5 });
      addBody('cylinder', { x: 1.9, z: 0.2, y: 0.5 });
      st.selected = [a.id, b.id];
      glueSelected();
      st.selected = [st.bodies[st.bodies.length - 1].id];
      refreshSelection();
    } else if (kind === 'view') {
      clearScene();
      var vb = addBody('box', { x: 0, z: 0, y: 1.2, dims: { w: 2.2, h: 1.4, d: 1.2 } });
      st.selected = [vb.id];
      refreshSelection();
      view.theta = 0.86; view.phi = 1.06; view.radius = 9.2; view.target.set(0, 1.0, 0);
      applyCam();
      viewFromCamera();   // 按当前相机方向投影，平面正对镜头
      renderer.render(scene, camera);
    } else if (kind === 'sim') {
      clearScene();
      addBody('box', { x: 0, z: 0, y: 0.45, mass: 1 });
      addBody('box', { x: 0.1, z: 0, y: 2.6, mass: 1 });
      addBody('sphere', { x: 0.05, z: 0, y: 4.0, mass: 1.5, e: 0.3 });
      st.gravity = 9.8;
      for (var j = 0; j < 150; j++) simStep(1 / 60);
      st.selected = [];
      refreshSelection();
    }
  }

  /* 初始示例 */
  addBody('box', { x: -0.75, z: 0.1, y: 0.41, dims: { w: 1.4, h: 0.8, d: 1.0 } });
  addBody('sphere', { x: 1.1, z: -0.2, y: 0.52 });
  st.selected = [];
  refreshSelection();
  requestAnimationFrame(frame);
  if (location.search.indexOf('test=1') >= 0) setTimeout(runSelfTest, 40);
  var demoKind = (location.search.match(/demo=([a-z0-9]+)/) || [])[1];
  if (demoKind) setTimeout(function () { runDemo(demoKind); }, 40);
})();
