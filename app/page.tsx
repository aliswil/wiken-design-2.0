import Image from "next/image";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center">
      <div className="relative w-full max-w-2xl h-64 md:h-96">
        <Image
          src="/logo_svart.png"
          alt="Wiken Design Logo"
          fill
          className="object-contain"
          priority
        />
      </div>
    </div>
  );
}
