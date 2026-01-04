export default function Footer() {
  return (
    <footer className="py-8 bg-background">
      <div className="container mx-auto text-center">
        <p className="text-gray-600">© {new Date().getFullYear()} Wiken Design</p>
      </div>
    </footer>
  );
}
