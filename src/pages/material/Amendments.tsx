import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const Amendments: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    navigate("/material", { replace: true });
  }, [navigate]);

  return null;
};

export default Amendments;
