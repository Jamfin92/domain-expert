using Routes.Api.Models;

namespace Routes.Api.Services;

public class Calculator
{
    public int Add(int a, int b)
    {
        Widget w = null!;
        return a + b + w.Id;
    }
}
