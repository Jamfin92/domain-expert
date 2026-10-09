using Microsoft.EntityFrameworkCore;
using Routes.Api.Models;

namespace Routes.Api.Data;

public class RoutesDbContext : DbContext
{
    public DbSet<Widget> Widgets { get; set; } = null!;
    public DbSet<Gadget> Gadgets { get; set; } = null!;
    public DbSet<Sprocket> Sprockets { get; set; } = null!;
    public DbSet<Part> Parts { get; set; } = null!;
}
