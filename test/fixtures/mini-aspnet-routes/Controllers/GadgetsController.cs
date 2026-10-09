using Microsoft.AspNetCore.Mvc;
using Routes.Api.Services;

namespace Routes.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class GadgetsController : ControllerBase
{
    private readonly IGadgetService _gadgets;
    private readonly ILogger<GadgetsController> _log;

    public GadgetsController(IGadgetService gadgets, ILogger<GadgetsController> log)
    {
        _gadgets = gadgets;
        _log = log;
    }

    [HttpGet("{id}")]
    public IActionResult Get(int id) => Ok(_gadgets.Assemble(id));

    [HttpPut("{id}/retire")]
    public IActionResult Retire(int id)
    {
        _gadgets.Retire(id);
        return Ok();
    }

    [HttpGet("deep")]
    public IActionResult Deep() => Ok(Chain.Step0());

    [HttpGet("calc")]
    public IActionResult Calc()
    {
        var calc = new Calculator();
        return Ok(calc.Add(1, 2));
    }

    [HttpGet("{id}/opaque")]
    public IActionResult Opaque(int id)
    {
        _log.LogInformation("opaque");
        return Ok(Helpers.Format(id));
    }
}
