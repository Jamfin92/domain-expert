using Routes.Api.Data;
using Routes.Api.Models;

namespace Routes.Api.Repositories;

public class GadgetRepository : IGadgetRepository
{
    private readonly RoutesDbContext _db;

    public GadgetRepository(RoutesDbContext db)
    {
        _db = db;
    }

    public Gadget Load(int id) => _db.Gadgets.Find(id)!;

    public void Remove(int id)
    {
        _db.Gadgets.Remove(Load(id));
    }
}
