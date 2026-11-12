using System.Windows;
using System.Windows.Media.Imaging;

namespace GlassDock.Rendering;

internal static class MaterialContrast
{
    [ThreadStatic] private static byte[]? _pixel;

    /// <summary>Uses the median of a regional BGRA material's nine interior samples.</summary>
    internal static double SampleLuminance(BitmapSource frame)
    {
        byte[] pixel = _pixel ??= new byte[4];
        Span<double> samples = stackalloc double[9];
        int index = 0;
        for (int row = 0; row < 3; row++)
        {
            int y = (frame.PixelHeight - 1) * (2 + 3 * row) / 10;
            for (int column = 0; column < 3; column++)
            {
                int x = (frame.PixelWidth - 1) * (2 + 3 * column) / 10;
                frame.CopyPixels(new Int32Rect(x, y, 1, 1), pixel, 4, 0);
                samples[index++] = (.2126 * pixel[2] + .7152 * pixel[1] + .0722 * pixel[0]) / 255;
            }
        }

        for (int current = 1; current < samples.Length; current++)
        {
            double value = samples[current];
            int previous = current - 1;
            while (previous >= 0 && samples[previous] > value)
            {
                samples[previous + 1] = samples[previous];
                previous--;
            }
            samples[previous + 1] = value;
        }

        return samples[4];
    }
}
