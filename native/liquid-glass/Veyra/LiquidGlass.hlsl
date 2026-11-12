// The pass order is intentionally O1 -> O2 -> O3 -> O4 -> O5 -> O6.
// Background is captured/composed and mipmapped by GlassRenderer BEFORE this pass.
// WPF renders interactive icons/text AFTER this material; they never enter this texture.
Texture2D<float4> paintComposeRT : register(t0);
SamplerState backgroundSampler : register(s0);

cbuffer GlassParameters : register(b0)
{
    float2 outputSize;
    float2 captureSize;
    float2 captureOffset;
    float cornerRadius;
    float surfaceInset;
    float uGlassThickness;
    float uNormalTransition;
    float uBackgroundDistance;
    float uIOR;
    float uDispersion;
    float uRoughness;
    float uTint;
    float uTime;
};

struct VertexOutput { float4 position : SV_Position; float2 uv : TEXCOORD0; };
VertexOutput FullscreenVS(uint vertexId : SV_VertexID)
{
    VertexOutput o;
    o.uv = float2((vertexId << 1) & 2, vertexId & 2);
    o.position = float4(o.uv * float2(2, -2) + float2(-1, 1), 0, 1);
    return o;
}

// O2 / SDF: coordinates are height-normalized, so a circle stays circular on resize.
float2 correctedPosition(float2 uv) { return (uv - 0.5) * float2(outputSize.x / outputSize.y, 1); }
float2 positionToUv(float2 p) { return p / float2(outputSize.x / outputSize.y, 1) + 0.5; }
float circleSdf(float2 p, float radius) { return length(p) - radius; }
float roundedRectSdf(float2 p, float2 halfSize, float radius)
{
    float2 q = abs(p) - halfSize + radius;
    return min(max(q.x, q.y), 0) + length(max(q, 0)) - radius;
}
// Available for compound surfaces; all combinations operate on SDFs, never RGB masks.
float polynomialSmoothMin(float a, float b, float k)
{
    float h = saturate(0.5 + 0.5 * (b - a) / max(k, 0.00001));
    return lerp(b, a, h) - k * h * (1 - h);
}
float glassSurfaceSdf(float2 p)
{
    float2 halfSize = float2(outputSize.x / outputSize.y, 1) * 0.5 - surfaceInset;
    float radius = min(cornerRadius, min(halfSize.x, halfSize.y));
    return roundedRectSdf(p, halfSize, radius);
}

// O3 / HEIGHT: a strictly flat central face with a quintic, C2-continuous bevel.
float quintic(float t) { return t*t*t * (t * (t * 6 - 15) + 10); }
float surfaceHeight(float2 p)
{
    float interior = max(-glassSurfaceSdf(p), 0);
    float bevel = max(uNormalTransition * 0.82, 0.0001);
    float t = saturate(interior / bevel);
    return uGlassThickness * quintic(t); // t == 1 is exactly constant.
}
float3 surfaceNormal(float2 p, float centerHeight, out float2 gradient, out float curvature)
{
    float stepSize = clamp(uNormalTransition * 0.13, 0.003, 0.012);
    // Offsets are in corrected space, not uncorrected UV: X includes aspect correction.
    float left = surfaceHeight(p - float2(stepSize, 0));
    float right = surfaceHeight(p + float2(stepSize, 0));
    float down = surfaceHeight(p - float2(0, stepSize));
    float up = surfaceHeight(p + float2(0, stepSize));
    gradient = float2(right - left, up - down) / (2 * stepSize);
    // Second differences describe curvature; gradient magnitude alone only describes slope.
    curvature = abs(right + left + up + down - 4 * centerHeight) / (stepSize * stepSize);
    // A finite stencil can straddle the bevel even when its center is already on
    // the constant plateau. Constrain its tail continuously to that flat face.
    float bevel = max(uNormalTransition * 0.82, 0.0001);
    float bevelT = saturate(max(-glassSurfaceSdf(p), 0) / bevel);
    float bevelKernelSupport = 1 - smoothstep(0.8, 1, bevelT);
    gradient *= bevelKernelSupport;
    curvature *= bevelKernelSupport;
    return normalize(float3(-gradient, 1));
}

// O4 / AIR -> GLASS -> AIR -> BACKGROUND: actual thickness and plane intersections.
float3 safeRefract(float3 incident, float3 normal, float eta)
{
    float3 ray = refract(incident, normal, eta);
    return dot(ray, ray) > 0.000001 ? normalize(ray) : float3(0, 0, -1);
}
float2 traceRay(float2 p, float height, float3 normal, float ior)
{
    float3 incident = float3(0, 0, -1);
    float3 insideRay = safeRefract(incident, normal, 1 / ior);
    float glassPath = height / max(-insideRay.z, 0.025);
    float3 backPoint = float3(p, height) + insideRay * glassPath;
    float3 outsideRay = safeRefract(insideRay, float3(0, 0, 1), ior);
    float airPath = uBackgroundDistance / max(-outsideRay.z, 0.025);
    return positionToUv((backPoint + outsideRay * airPath).xy);
}
float2 captureUv(float2 uv) { return (captureOffset + uv * outputSize) / captureSize; }
float3 sampleBackground(float2 uv, float lod)
{
    return paintComposeRT.SampleLevel(backgroundSampler, captureUv(uv), lod).rgb;
}
float3 sampleSpectrum(float2 baseUv, float2 rayR, float2 rayG, float2 rayB, float lod)
{
    // Dispersion exists only in rim paths. No RGB offsets are applied to the face.
    return float3(sampleBackground(baseUv + rayR - rayG, lod).r,
                  sampleBackground(baseUv, lod).g,
                  sampleBackground(baseUv + rayB - rayG, lod).b);
}

// O6 helpers / dielectric GGX, correlated Smith visibility, Schlick Fresnel.
float distributionGGX(float NoH, float alpha)
{
    float alpha2 = alpha * alpha;
    float d = NoH * NoH * (alpha2 - 1) + 1;
    return alpha2 / max(3.14159265359 * d * d, 0.00001);
}
float smithHeightCorrelated(float NoV, float NoL, float alpha)
{
    float alpha2 = alpha * alpha;
    float lambdaV = NoL * sqrt(NoV * NoV * (1 - alpha2) + alpha2);
    float lambdaL = NoV * sqrt(NoL * NoL * (1 - alpha2) + alpha2);
    return 0.5 / max(lambdaV + lambdaL, 0.00001);
}
float schlick(float VoH, float f0) { return f0 + (1-f0) * pow(1-VoH, 5); }
float lightingSupport(float bevelT, float curvature, float bevel)
{
    float curvatureWeight = saturate(curvature * bevel * 0.7);
    float outerBevelSupport = 1 - smoothstep(0.32, 0.50, bevelT);
    return outerBevelSupport * curvatureWeight;
}

float4 GlassPS(VertexOutput input) : SV_Target
{
    // O1: paintComposeRT already contains the REAL desktop with this app excluded.
    float2 uv = input.uv;
    float2 p = correctedPosition(uv);

    // O2: stable antialias mask, derived only from signed distance.
    float sdf = glassSurfaceSdf(p);
    float aa = max(fwidth(sdf), 0.5 / outputSize.y);
    float mask = 1 - smoothstep(-aa, aa, sdf);
    // O2 evaluates only the silhouette. Shadow coverage is composed in O6.
    if (mask <= 0.0001)
    {
        float outsideShadow = exp(-max(sdf, 0) * outputSize.y / 4.0) * 0.16;
        return float4(0, 0, 0, outsideShadow);
    }

    // O3: low-noise SDF height is separate from the antialias mask.
    float interior = max(-sdf, 0);
    float bevel = max(uNormalTransition * 0.82, 0.0001);
    float bevelT = saturate(interior / bevel);
    float height = surfaceHeight(p);
    float2 gradient;
    float curvature;
    float3 normal = surfaceNormal(p, height, gradient, curvature);
    float2 rimDirection = length(normal.xy) > 0.00001 ? normalize(normal.xy) : float2(0, 0);

    // O4: three independent physical paths; stable fallback for total internal reflection.
    float2 rayR = traceRay(p, height, normal, max(1.001, uIOR-uDispersion));
    float2 rayG = traceRay(p, height, normal, uIOR);
    float2 rayB = traceRay(p, height, normal, uIOR+uDispersion);

    // O5: face, inner compression and opposite outer roll/bleed.
    float2 opticalCenter = float2(0.5, 0.5);
    float2 faceUv = lerp(opticalCenter + (uv-opticalCenter)*0.975, rayG, 0.08);
    // Use the measured two-interface path in corrected space. Local height tends
    // to zero at the rim and would suppress the outer roll where it is weighted.
    float rimDisplacement = length((rayG - uv) * float2(outputSize.x / outputSize.y, 1)) * 0.7;
    float2 correctedToUv = float2(outputSize.y / outputSize.x, 1);
    float2 innerUv = rayG - rimDirection * rimDisplacement * correctedToUv;
    float2 outerUv = uv + rimDirection * rimDisplacement * 1.28 * correctedToUv;
    float faceWeight = smoothstep(0.36, 1, bevelT);
    float outerWeight = (1-faceWeight) * (1-smoothstep(0.08, 0.52, bevelT));
    float innerWeight = max(0, 1-faceWeight-outerWeight);
    float weightSum = max(faceWeight+innerWeight+outerWeight, 0.0001);
    float3 weights = float3(faceWeight,innerWeight,outerWeight) / weightSum;
    float3 face = sampleBackground(faceUv, 2.3);
    float3 inner = sampleSpectrum(innerUv, rayR,rayG,rayB, 0.55);
    float3 outer = sampleSpectrum(outerUv, rayR,rayG,rayB, 3.0);
    float3 refracted = face*weights.x + inner*weights.y + outer*weights.z;

    // O6: REFRACT -> external SHADOW -> TINT -> LIGHT, in that order.
    float3 material = refracted;
    float shadow = exp(-max(sdf, 0) * outputSize.y / 4.0) * 0.16;
    float composedAlpha = mask + shadow * (1-mask);
    material = lerp(material, float3(0.96,0.98,1.0), saturate(uTint));
    float3 view = float3(0,0,1);
    float NoV = saturate(dot(normal,view));
    float f0 = pow((uIOR-1)/(uIOR+1),2);
    float alpha = max(uRoughness*uRoughness,0.02);
    float support = lightingSupport(bevelT, curvature, bevel);
    float3 specular = 0;
    [unroll] for (int i=0; i<4; ++i)
    {
        float angle = i*1.57079632679 + uTime*0.035;
        float z = 0.28 + 0.043 * i;
        float xy = sqrt(1-z*z);
        float3 light = float3(cos(angle)*xy,sin(angle)*xy,z);
        float3 halfVector = normalize(view+light);
        float NoL = saturate(dot(normal,light));
        float NoH = saturate(dot(normal,halfVector));
        float VoH = saturate(dot(view,halfVector));
        float3 lightColor = (i%2 == 0) ? float3(1.0,0.94,0.87) : float3(0.86,0.94,1.0);
        specular += lightColor * distributionGGX(NoH,alpha) *
                    smithHeightCorrelated(NoV,NoL,alpha) * schlick(VoH,f0) * NoL * 0.70;
    }
    float environmentFresnel = schlick(NoV,f0) * 0.60;
    material += (specular + environmentFresnel * float3(0.86,0.93,1.0)) * support;
    // Premultiplied alpha is required by WPF Pbgra32. No painted full white outline.
    return float4(saturate(material)*mask, composedAlpha);
}
