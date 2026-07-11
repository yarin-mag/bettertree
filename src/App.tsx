import Sidebar from "./components/Sidebar";
import CommitGraph from "./components/CommitGraph";
import SearchBar from "./components/SearchBar";
import Toolbar from "./components/Toolbar";
import CommitDrawer from "./components/CommitDrawer";

export default function App() {
  return (
    <div className="h-screen w-screen flex flex-col bg-canvas text-text-primary">
      <SearchBar />
      <Toolbar />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <CommitGraph />
          <CommitDrawer />
        </div>
      </div>
    </div>
  );
}
