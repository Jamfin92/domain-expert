using Microsoft.AspNetCore.Mvc;

namespace Routes.Api.Controllers;

public partial class PartialController
{
    [HttpGet("one")]
    public IActionResult One() => Ok();
}
