using Routes.Api.Models;

namespace Routes.Api.Services;

public class EmailNotifier : INotifier
{
    public void Send(int id)
    {
        Sprocket s = null!;
    }
}

public class SmsNotifier : INotifier
{
    public void Send(int id)
    {
        Widget w = null!;
    }
}
