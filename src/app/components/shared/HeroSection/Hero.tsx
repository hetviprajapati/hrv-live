type HeroProps = {
  title: string;
  description: string;
};
import './Hero.css';

export function Hero({ title, description }: HeroProps) {
  return (
    <div className="page-hero">
      <h1>{title}</h1>

      <p className="page-hero-sub">{description}</p>
    </div>
  );
}
