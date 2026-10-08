using Microsoft.AspNetCore.Mvc;

namespace Routes.Api.Controllers;

[Route("base")]
public abstract class BaseApiController : ControllerBase
{
    [HttpGet("shared")]
    public IActionResult Shared() => Ok();
}

public class ChildController : BaseApiController
{
    [HttpGet("own")]
    public IActionResult Own() => Ok();
}
