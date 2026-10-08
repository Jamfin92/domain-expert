using Microsoft.AspNetCore.Mvc;

namespace Routes.Api.Controllers;

[Route("m1")]
[Route("m2")]
public class MultiController : ControllerBase
{
    [HttpGet("x")]
    public IActionResult X() => Ok();
}
