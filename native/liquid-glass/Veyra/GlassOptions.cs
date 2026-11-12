namespace GlassDock.Rendering;

/// <summary>Lengths are physical pixels; the shader converts them to height-normalized space.</summary>
public sealed record GlassOptions
{
    public float CornerRadiusPixels { get; init; } = 24;
    public float SurfaceInsetPixels { get; init; } = 2;
    public float ThicknessPixels { get; init; } = 8;
    public float NormalTransitionPixels { get; init; } = 12.5f;
    public float BackgroundDistancePixels { get; init; } = 24;
    public float Ior { get; init; } = 1.46f;
    public float Dispersion { get; init; } = 0.009f;
    public float Roughness { get; init; } = 0.32f;
    public float Tint { get; init; } = 0.035f;
    // Null advances the four grazing lights at up to 4 Hz on a static background.
    // Zero explicitly freezes the light pose; setting a new value intentionally requests a frame.
    public float? LightTimeSeconds { get; init; }
}
