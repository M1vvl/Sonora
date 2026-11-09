// Agent Pulse: GPU output target, independently authored, AGPL-3.0-or-later.
// This resizes an intermediate RGB texture; it does not change source quality.
//!HOOK MAIN
//!BIND HOOKED
//!DESC AgentPulse GPU target 1920x1080
//!WIDTH NATIVE.w NATIVE.h / 1.7777777778 > 1920 * NATIVE.w NATIVE.h / 1.7777777778 > ! NATIVE.w NATIVE.h / 1080 * * +
//!HEIGHT NATIVE.w NATIVE.h / 1.7777777778 > 1920 NATIVE.w NATIVE.h / / * NATIVE.w NATIVE.h / 1.7777777778 > ! 1080 * +

float ap_weight(float x) {
    x = abs(x);
    if (x < 1.0) return (1.5*x - 2.5)*x*x + 1.0;
    if (x < 2.0) return ((-0.5*x + 2.5)*x - 4.0)*x + 2.0;
    return 0.0;
}
vec4 hook() {
    vec2 pos = HOOKED_pos * HOOKED_size - vec2(0.5);
    vec2 base = floor(pos);
    vec2 fraction = pos - base;
    vec4 color = vec4(0.0);
    float total = 0.0;
    for (int y = -1; y <= 2; y++) {
        for (int x = -1; x <= 2; x++) {
            vec2 offset = vec2(float(x), float(y));
            float weight = ap_weight(offset.x-fraction.x) * ap_weight(offset.y-fraction.y);
            color += HOOKED_tex((base+offset+vec2(0.5))*HOOKED_pt) * weight;
            total += weight;
        }
    }
    return color / max(total, 0.0001);
}
