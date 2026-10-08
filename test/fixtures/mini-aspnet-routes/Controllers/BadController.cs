using Microsoft.AspNetCore.Mvc;

namespace Routes.Api.Controllers;

[Route("bad")]
public class BadController : ControllerBase
{
    [HttpGet("[unknown]/x")]
    public IActionResult Tok() => Ok();

    [HttpGet(Routes.Items)]
    public IActionResult Lit() => Ok();

    [Route("verbless")]
    public IActionResult Verbless() => Ok();

    public IActionResult Undecided() => Ok();

    [HttpGet("ok")]
    public IActionResult Fine() => Ok();
}

[Route("async/[action]")]
public class AsyncController : ControllerBase
{
    [HttpGet]
    public Task<IActionResult> FetchAsync() => null!;
}
