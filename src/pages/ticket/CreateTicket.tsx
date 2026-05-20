import Webcam from "react-webcam";
import React, {
  useEffect,
  useRef,
  useState,
} from "react";

const CreateTicket = () => {

  const [companies, setCompanies] = useState<any[]>([]);

  const [projects, setProjects] = useState<any[]>([]);

  const [companyId, setCompanyId] = useState("");

  const [projectId, setProjectId] = useState("");

  const [subject, setSubject] =
  useState("");

const [priority, setPriority] =
  useState("Medium");

const [issueDetails, setIssueDetails] =
  useState("");

const [customerName, setCustomerName] =
  useState("");

const [customerPhone, setCustomerPhone] =
  useState("");

  const [showCamera, setShowCamera] =
  useState(false);

const [capturedImage, setCapturedImage] =
  useState<string | null>(null);

const webcamRef = useRef<Webcam>(null);

  useEffect(() => {
    fetchDropdowns();
  }, []);

  const fetchDropdowns = async () => {
    try {

      const token = localStorage.getItem("token");

const res = await fetch(
  "/api/business/dropdown",
  {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }
);

      const data = await res.json();

      setCompanies(data.companies || []);

      setProjects(data.projects || []);

    } catch (err) {
      console.log(err);
    }
  };

  const capturePhoto = () => {

    const imageSrc =
      webcamRef.current?.getScreenshot();
  
    if (imageSrc) {
      setCapturedImage(imageSrc);
  
      setShowCamera(false);
    }
  };

  const handleSubmit = async () => {

    try {
  
      const token =
        localStorage.getItem("token");
  
      const res = await fetch(
        "/api/tickets/create",
        {
          method: "POST",
  
          headers: {
            "Content-Type":
              "application/json",
  
            Authorization:
              `Bearer ${token}`,
          },
  
          body: JSON.stringify({
            subject,
            priority,
            issue_details: issueDetails,
            customer_name: customerName,
            customer_phone: customerPhone,
            company_id: companyId,
            project_id: projectId,
            attachment_path: capturedImage,
          }),
        }
      );
  
      const data = await res.json();
  
      if (data.success) {
  
        alert("Ticket Created");
  
        window.location.href =
          "/ticket/pending";
      }
  
    } catch (err) {
  
      console.log(err);
  
      alert("Failed");
    }
  };

  return (
    <div className="max-w-5xl mx-auto">

      <div className="rounded-2xl border border-border bg-card p-6">

        <h1 className="text-3xl font-bold mb-6">
          Create Ticket
        </h1>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

          <div className="md:col-span-2">

            <label className="block mb-2">
              Subject
            </label>

            <input
              className="w-full h-12 rounded-xl border border-border bg-background px-4"
              placeholder="Enter issue subject"
            />
          </div>

          {/* COMPANY */}

          <div>

            <label className="block mb-2">
              Company
            </label>

            <select
              value={companyId}
              onChange={(e) =>
                setCompanyId(e.target.value)
              }
              className="w-full h-12 rounded-xl border border-border bg-background px-4"
            >

              <option value="">
                Select Company
              </option>

              {companies.map((company) => (
                <option
                  key={company.id}
                  value={company.id}
                >
                  {company.name}
                </option>
              ))}

            </select>
          </div>

          {/* PROJECT */}

          <div>

            <label className="block mb-2">
              Project
            </label>

            <select
              value={projectId}
              onChange={(e) =>
                setProjectId(e.target.value)
              }
              className="w-full h-12 rounded-xl border border-border bg-background px-4"
            >

              <option value="">
                Select Project
              </option>

              {projects.map((project) => (
                <option
                  key={project.id}
                  value={project.id}
                >
                  {project.name}
                </option>
              ))}

            </select>
          </div>

          {/* PRIORITY */}

          <div>
            <label className="block mb-2">
              Priority
            </label>

            <select className="w-full h-12 rounded-xl border border-border bg-background px-4">
              <option>High</option>
              <option>Medium</option>
              <option>Low</option>
            </select>
          </div>

          {/* CUSTOMER NAME */}

          <div>
            <label className="block mb-2">
              Customer Name
            </label>

            <input className="w-full h-12 rounded-xl border border-border bg-background px-4" />
          </div>

          {/* PHONE */}

          <div>
            <label className="block mb-2">
              Phone Number
            </label>

            <input className="w-full h-12 rounded-xl border border-border bg-background px-4" />
          </div>

          {/* ISSUE */}

          <div className="md:col-span-2">

            <label className="block mb-2">
              Issue Details
            </label>

            <textarea
              rows={6}
              className="w-full rounded-xl border border-border bg-background p-4"
            />
          </div>

          {/* ATTACHMENT */}

          <div>

            <label className="block mb-2">
              Attachment
            </label>

            <input type="file" />
          </div>
          <div>

<label className="block mb-2">
  Camera
</label>

<button
  type="button"
  onClick={() =>
    setShowCamera(true)
  }
  className="h-12 px-4 rounded-xl bg-blue-600 text-white"
>
  Open Camera
</button>

</div>
        </div>

        <button className="mt-6 h-12 px-6 rounded-xl bg-primary text-white">
          Submit Ticket
        </button>

      </div>
      {showCamera && (

<div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">

  <div className="bg-card p-6 rounded-2xl w-[500px]">

    <h2 className="text-2xl font-bold mb-4">
      Capture Photo
    </h2>

    <Webcam
      ref={webcamRef}
      screenshotFormat="image/jpeg"
      className="rounded-xl w-full"
      videoConstraints={{
        facingMode: "environment",
      }}
    />

    <div className="flex gap-3 mt-4">

      <button
        onClick={capturePhoto}
        className="px-5 h-11 rounded-xl bg-green-600 text-white"
      >
        Capture
      </button>

      <button
        onClick={() =>
          setShowCamera(false)
        }
        className="px-5 h-11 rounded-xl bg-red-600 text-white"
      >
        Close
      </button>

    </div>

  </div>

</div>
)}

{capturedImage && (

<div className="mt-5">

  <p className="mb-2 font-medium">
    Captured Image
  </p>

  <img
    src={capturedImage}
    alt="Captured"
    className="w-52 rounded-xl border"
  />

</div>
)}
    </div>
  );
};

export default CreateTicket;