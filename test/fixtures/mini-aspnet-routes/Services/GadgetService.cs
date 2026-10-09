using Routes.Api.Models;
using Routes.Api.Repositories;

namespace Routes.Api.Services;

public class GadgetService : IGadgetService
{
    private readonly IGadgetRepository _repo;
    private readonly INotifier _notifier;

    public GadgetService(IGadgetRepository repo, INotifier notifier)
    {
        _repo = repo;
        _notifier = notifier;
    }

    public int Assemble(int id)
    {
        Gadget g = _repo.Load(id);
        Rebalance(id);
        return g.Id;
    }

    public void Retire(int id)
    {
        _notifier.Send(id);
        _repo.Remove(id);
    }

    private void Rebalance(int id)
    {
        Settle(id);
    }

    private void Settle(int id)
    {
        Rebalance(id);
    }
}
