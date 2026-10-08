using Microsoft.AspNetCore.Mvc;

namespace Routes.Api.Controllers;

[Route("verbs")]
public class VerbsController : ControllerBase
{
    [AcceptVerbs("GET", "POST")]
    public IActionResult Both() => Ok();

    [HttpGet("kept")]
    public IActionResult Kept() => Ok();
}
