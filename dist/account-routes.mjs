// Preserve saved links from the former account workspace.
export function accountDestination(view, result) {
  const routes = {
    home: '/workspace.html#home',
    projects: '/workspace.html#projects?scope=account',
    tasks: '/workspace.html#tasks?scope=account',
    agent: '/workspace.html#tasks?scope=account&view=agent',
    results: '/workspace.html#assets?scope=account',
    usage: '/workspace.html#account?view=usage',
    membership: '/workspace.html#membership?scope=account',
    help: '/workspace.html#help?scope=account',
    admin: '/admin.html'
  };
  const destination = Object.hasOwn(routes, view) ? routes[view] : routes.home;
  return view === 'results' && result ? destination + '&result=' + encodeURIComponent(result) : destination;
}
