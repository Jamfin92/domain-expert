using Routes.Api.Models;

namespace Routes.Api.Services;

public static class Chain
{
    public static int Step0() => Step1();
    public static int Step1() => Step2();
    public static int Step2() => Step3();
    public static int Step3() => Step4();
    public static int Step4() => Step5();
    public static int Step5()
    {
        Part p = null!;
        return p.Id;
    }
}
