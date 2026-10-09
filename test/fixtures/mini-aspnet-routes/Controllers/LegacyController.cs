namespace Routes.Api.Controllers;

// A controller by name alone: no base class, no class route.
public class LegacyController
{
    [HttpGet("legacy/items")]
    public string Items() => "";
}
